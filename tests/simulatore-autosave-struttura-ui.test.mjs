import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE,
  uniq,
  signup,
  newPool,
  launchBrowser,
  newAuthedContext,
  cleanupOrg,
} from './helpers/uiTest.mjs';

// Test UI end-to-end (Task #340): il SALVATAGGIO AUTOMATICO del Simulatore
// (Preventivatore) non deve MAI degradare la struttura reale salvata in
// organization_config.puntiVendita.
//
// Incidente 13/08/2026: l'autosave debounced del wizard ha sovrascritto la
// struttura reale di un'org con PDV "scheletro" (anagrafica vuota) generati
// da "Quanti PDV partecipano?". Il fix è su due livelli:
//   - client: Preventivatore OMETTE la chiave puntiVendita dal payload quando
//     nessun PDV del wizard ha anagrafica (hasAnagrafica);
//   - server: il PUT /api/organization-config re-inietta la chiave omessa e
//     blocca con 409 gli azzeramenti di massa (org-config-guard.test.mjs).
// Gli helper puri e la route sono già coperti; questo test chiude il cerchio
// sul PERCORSO ESATTO dell'incidente: browser reale, wizard reale, effect di
// autosave reale (debounce ~2.5s) e verifica diretta sul dev DB.
//
// Strategia: signup admin + org, semina in organization_config una struttura
// reale (3 PDV con anagrafica completa). Il config seminato NON ha
// configVersion '2.0' (come quando la struttura è gestita dagli endpoint
// /api/admin/struttura/*), quindi il wizard parte VUOTO — la stessa
// combinazione dell'incidente. Poi guidiamo la UI e assertiamo sul DB.

const DEBOUNCE_WAIT_MS = 6000; // debounce client 2.5s + rete/scrittura

const pdvReale = (i) => ({
  id: `pdv-340-${i}`,
  codicePos: `93400${i}`,
  nome: `Negozio Reale ${i}`,
  ragioneSociale: 'Struttura Reale S.R.L.',
  canale: 'franchising',
  tipoPosizione: 'strada',
});

const STRUTTURA = [pdvReale(0), pdvReale(1), pdvReale(2)];

// Semina la struttura reale. `withVersion` decide se il config è in formato
// wizard ('2.0', il Preventivatore lo carica) o "solo struttura" (il wizard
// parte vuoto — scenario incidente).
async function seedStruttura(pool, orgId, { withVersion = false } = {}) {
  const config = withVersion
    ? { puntiVendita: STRUTTURA, numeroPdv: STRUTTURA.length, configVersion: '2.0' }
    : { puntiVendita: STRUTTURA };
  await pool.query(
    `INSERT INTO organization_config (organization_id, config, config_version)
       VALUES ($1, $2, '2.0')
     ON CONFLICT (organization_id)
       DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
    [orgId, JSON.stringify(config)],
  );
}

async function readConfig(pool, orgId) {
  const r = await pool.query(
    `SELECT config FROM organization_config WHERE organization_id = $1`,
    [orgId],
  );
  return r.rows[0]?.config ?? null;
}

// La struttura letta dal DB deve essere ESATTAMENTE quella seminata.
function assertStrutturaIntatta(config, label) {
  const pv = config?.puntiVendita;
  assert.ok(Array.isArray(pv), `${label}: puntiVendita must still be an array`);
  assert.equal(pv.length, STRUTTURA.length, `${label}: struttura must keep ${STRUTTURA.length} PDV`);
  for (let i = 0; i < STRUTTURA.length; i++) {
    assert.equal(pv[i].codicePos, STRUTTURA[i].codicePos, `${label}: PDV ${i} codicePos intact`);
    assert.equal(pv[i].nome, STRUTTURA[i].nome, `${label}: PDV ${i} nome intact`);
    assert.equal(pv[i].ragioneSociale, STRUTTURA[i].ragioneSociale, `${label}: PDV ${i} ragioneSociale intact`);
  }
}

// Apre il wizard del Simulatore e avanza allo step "Punti Vendita".
async function openStepPuntiVendita(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/preventivatore`, { waitUntil: 'networkidle' });
  // Step 0 = Lettera gara; "Avanti" porta allo step con input-numero-pdv.
  await page.getByRole('button', { name: 'Avanti' }).click();
  await page.getByTestId('input-numero-pdv').waitFor({ state: 'visible', timeout: 15000 });
  return page;
}

// Attende che l'autosave debounced sia atterrato sul backend: polla il DB
// finché `predicate(config)` è vero (o scade il timeout).
async function waitForAutosave(pool, orgId, predicate, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const cfg = await readConfig(pool, orgId);
    if (cfg && predicate(cfg)) return cfg;
    if (Date.now() - start > timeoutMs) return cfg;
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ===========================================================================
// SCENARIO 1 (percorso incidente): wizard vuoto + struttura reale nel DB.
// L'utente imposta "Quanti PDV partecipano?" → il wizard genera PDV scheletro
// → l'autosave parte, ma la struttura nel DB NON deve essere degradata.
// ===========================================================================
test('scenario 1: autosave with skeleton PDVs must not degrade the real struttura', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'sim_autosave', fullName: 'Sim Autosave Test', organizationName: uniq('SimAutosaveOrg') });
  const browser = await launchBrowser();
  try {
    await seedStruttura(pool, session.orgId, { withVersion: false });

    const context = await newAuthedContext(browser, session);
    const page = await openStepPuntiVendita(context);

    // Il wizard è partito VUOTO (config senza configVersion '2.0'):
    // nessun PDV precompilato nello step.
    assert.equal(
      await page.getByTestId('input-codice-pos-0').count(),
      0, 'wizard must start with no PDV rows (empty state, incident precondition)',
    );

    // Cambia "Quanti PDV partecipano?" → genera 3 PDV scheletro nel wizard.
    await page.getByTestId('input-numero-pdv').fill('3');
    await page.getByTestId('input-codice-pos-0').waitFor({ state: 'visible', timeout: 10000 });

    // Aspetta che l'autosave debounced (2.5s) abbia scritto sul backend:
    // il payload del wizard porta numeroPdv=3, quindi quando la chiave appare
    // nel config sappiamo che il PUT è ATTERRATO (il test non è vacuo).
    const cfg = await waitForAutosave(pool, session.orgId, (c) => c.numeroPdv === 3);
    assert.equal(cfg?.numeroPdv, 3, 'the autosave PUT must have landed (numeroPdv persisted)');

    // La struttura reale è intatta: la chiave puntiVendita è stata omessa dal
    // client (nessun PDV con anagrafica) e re-iniettata dal server.
    assertStrutturaIntatta(cfg, 'after skeleton autosave');

    // Margine extra: eventuali PUT ritardatari non devono degradare nulla.
    await page.waitForTimeout(DEBOUNCE_WAIT_MS);
    assertStrutturaIntatta(await readConfig(pool, session.orgId), 'after grace period');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: wizard che CARICA la struttura reale (config '2.0') e utente
// che azzera "Quanti PDV partecipano?" → l'autosave non deve mai spingere
// un array vuoto al posto della struttura reale.
// ===========================================================================
test('scenario 2: zeroing the PDV count must not wipe the real struttura', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'sim_autosave', fullName: 'Sim Autosave Test', organizationName: uniq('SimAutosaveOrg') });
  const browser = await launchBrowser();
  try {
    await seedStruttura(pool, session.orgId, { withVersion: true });

    const context = await newAuthedContext(browser, session);
    const page = await openStepPuntiVendita(context);

    // Il wizard HA caricato la struttura reale dal backend.
    await page.getByTestId('input-codice-pos-0').waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(
      await page.getByTestId('input-codice-pos-0').inputValue(),
      STRUTTURA[0].codicePos, 'wizard must have loaded the real struttura from the backend',
    );

    // Azzeramento del conteggio: il wizard svuota i PDV in memoria.
    await page.getByTestId('input-numero-pdv').fill('0');
    await page.getByTestId('input-codice-pos-0').waitFor({ state: 'detached', timeout: 10000 });

    // Lascia scadere ampiamente il debounce: NESSUN PUT deve degradare il DB.
    await page.waitForTimeout(DEBOUNCE_WAIT_MS);
    assertStrutturaIntatta(await readConfig(pool, session.orgId), 'after zeroing the PDV count');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
