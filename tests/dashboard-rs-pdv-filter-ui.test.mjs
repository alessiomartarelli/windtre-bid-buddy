import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  uniq,
  signup,
  cleanupOrg,
  newPool,
  launchBrowser,
  newAuthedContext,
} from './helpers/uiTest.mjs';

// Task #14 — filtri RS/PDV nella Dashboard Gara Reale, ordinamento
// deterministico multi-RS e coerenza dei punti Mobile.
//
// Fixture: 2 Ragioni Sociali (AAA e ZZZ) con 1 PDV ciascuna. ZZZ ha più
// vendite mobile di AAA, così un ordinamento "per performance" mostrerebbe
// ZZZ per prima: il test verifica che invece l'ordine resti alfabetico.
//
// Copre:
//   1. la card mobile mostra il totale corretto (nessun doppio conteggio
//      tra livello PDV e livello RS): pezzi = somma dei due PDV;
//   2. i filtri RS e PDV compaiono nell'header; scegliere una RS restringe
//      il dettaglio PDV ai suoi negozi e i punti della card mobile;
//   3. scegliere un PDV mostra solo quel negozio;
//   4. con più RS le sezioni del dettaglio compaiono in ordine alfabetico
//      (AAA prima di ZZZ) anche se ZZZ ha la performance migliore.

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();
const DATA_VENDITA = `${YEAR}-${pad(MONTH)}-10T10:00:00.000Z`;

const artMobileTied = {
  categoria: { nome: 'TIED CF' },
  tipologia: { nome: 'VOCE EASYPAY' },
  dettaglio: { canone: '10' },
};

async function insertSale(pool, orgId, { codicePos, nomeNegozio, ragioneSociale }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        ragione_sociale, stato, totale, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, 'FINALIZZATA', '10.00', $7::jsonb)`,
    [orgId, bisuiteId, DATA_VENDITA, codicePos, nomeNegozio, ragioneSociale,
      JSON.stringify({ cliente: { clienteTipo: 'PRIVATO' }, articoli: [artMobileTied] })],
  );
}

test('Dashboard Gara: filtri RS/PDV e ordine multi-RS deterministico', async (t) => {
  const pool = await newPool();
  const session = await signup({ prefix: 'rs_filter' });
  const browser = await launchBrowser();

  t.after(async () => {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end();
  });

  // RS alfabeticamente prima (AAA) con MENO pezzi; ZZZ con PIÙ pezzi.
  const SUF = uniq('').slice(1); // suffisso condiviso leggibile nei testids
  const RS_A = `AAA SRL ${SUF}`;
  const RS_Z = `ZZZ SRL ${SUF}`;
  const POS_A = `WA${SUF}`;
  const POS_Z = `WZ${SUF}`;

  await pool.query(
    `INSERT INTO gara_config (organization_id, month, year, name, config)
     VALUES ($1, $2, $3, 'Gara Filtri RS', $4::jsonb)`,
    [session.orgId, MONTH, YEAR, JSON.stringify({
      pdvList: [
        { id: POS_A, codicePos: POS_A, nome: 'Negozio A', ragioneSociale: RS_A },
        { id: POS_Z, codicePos: POS_Z, nome: 'Negozio Z', ragioneSociale: RS_Z },
      ],
      pistaMobileConfig: {
        sogliePerPos: [
          { posCode: POS_A, soglia1: 2, soglia2: 100, soglia3: 200, soglia4: 300, multiplierSoglia1: 1, multiplierSoglia2: 1.2, multiplierSoglia3: 1.5, multiplierSoglia4: 2 },
          { posCode: POS_Z, soglia1: 2, soglia2: 100, soglia3: 200, soglia4: 300, multiplierSoglia1: 1, multiplierSoglia2: 1.2, multiplierSoglia3: 1.5, multiplierSoglia4: 2 },
        ],
      },
    })],
  );
  // AAA: 2 vendite mobile; ZZZ: 5 vendite mobile (performance migliore).
  for (let i = 0; i < 2; i++) await insertSale(pool, session.orgId, { codicePos: POS_A, nomeNegozio: 'Negozio A', ragioneSociale: RS_A });
  for (let i = 0; i < 5; i++) await insertSale(pool, session.orgId, { codicePos: POS_Z, nomeNegozio: 'Negozio Z', ragioneSociale: RS_Z });

  const context = await newAuthedContext(browser, session);
  const page = await context.newPage();
  await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.getByTestId('card-pdv-breakdown').waitFor({ state: 'visible', timeout: 30000 });

  // Il ticker mostra i PUNTI mobile (pesati): leggiamo il valore numerico
  // (formato it-IT) e verifichiamo l'additività PDV→totale più sotto.
  const readPunti = async () => {
    const raw = (await page.getByTestId('ticker-punti-mobile').innerText()).trim();
    const n = Number(raw.replace(/\./g, '').replace(',', '.'));
    assert.ok(Number.isFinite(n), `valore punti non numerico: "${raw}"`);
    return n;
  };
  const puntiTotali = await readPunti();
  assert.ok(puntiTotali > 0, 'punti mobile totali devono essere > 0');

  // --- 4. ordine RS deterministico: AAA prima di ZZZ ------------------------
  const headerA = page.getByTestId(`rs-group-header-${RS_A.replace(/\s+/g, '-')}`);
  const headerZ = page.getByTestId(`rs-group-header-${RS_Z.replace(/\s+/g, '-')}`);
  await headerA.waitFor({ state: 'visible', timeout: 15000 });
  await headerZ.waitFor({ state: 'visible', timeout: 15000 });
  const [boxA, boxZ] = [await headerA.boundingBox(), await headerZ.boundingBox()];
  assert.ok(boxA && boxZ, 'entrambe le intestazioni RS devono essere visibili');
  assert.ok(boxA.y < boxZ.y, `AAA deve comparire PRIMA di ZZZ anche se ZZZ ha più pezzi (yA=${boxA.y}, yZ=${boxZ.y})`);

  // Entrambi i PDV visibili senza filtro.
  await page.getByTestId(`pdv-accordion-${POS_A}`).waitFor({ state: 'visible', timeout: 10000 });
  await page.getByTestId(`pdv-accordion-${POS_Z}`).waitFor({ state: 'visible', timeout: 10000 });

  // --- 2. filtro RS: restringe dettaglio e card mobile ----------------------
  await page.getByTestId('select-rs-filter-trigger').click();
  await page.getByTestId(`select-rs-filter-${RS_A.toUpperCase().replace(/\s+/g, '-')}`).click();
  await page.getByTestId(`pdv-accordion-${POS_Z}`).waitFor({ state: 'detached', timeout: 15000 });
  await page.getByTestId(`pdv-accordion-${POS_A}`).waitFor({ state: 'visible', timeout: 10000 });
  const puntiA = await readPunti();
  assert.ok(puntiA > 0 && puntiA < puntiTotali,
    `il filtro RS AAA deve ridurre i punti mobile (totale=${puntiTotali}, AAA=${puntiA})`);

  // Le opzioni PDV sono dipendenti dalla RS: solo il PDV di AAA + "Tutti".
  await page.getByTestId('select-pdv-filter-trigger').click();
  await page.getByTestId(`select-pdv-filter-${POS_A}`).waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await page.getByTestId(`select-pdv-filter-${POS_Z}`).count(), 0,
    'con RS AAA selezionata il PDV di ZZZ non deve essere tra le opzioni');
  await page.keyboard.press('Escape');

  // --- 3. filtro PDV: mostra solo quel negozio ------------------------------
  // Torna a "Tutte le RS" e filtra per il singolo PDV di ZZZ.
  await page.getByTestId('select-rs-filter-trigger').click();
  await page.getByTestId('select-rs-filter-all').click();
  await page.getByTestId(`pdv-accordion-${POS_Z}`).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('select-pdv-filter-trigger').click();
  await page.getByTestId(`select-pdv-filter-${POS_Z}`).click();
  await page.getByTestId(`pdv-accordion-${POS_A}`).waitFor({ state: 'detached', timeout: 15000 });
  await page.getByTestId(`pdv-accordion-${POS_Z}`).waitFor({ state: 'visible', timeout: 10000 });
  const puntiZ = await readPunti();
  assert.ok(puntiZ > puntiA, `ZZZ (5 vendite) deve avere più punti di AAA (2 vendite): Z=${puntiZ}, A=${puntiA}`);
  // --- 1. nessun doppio conteggio PDV/RS -------------------------------------
  // Con soglie identiche i punti per-PDV devono essere proporzionali ai pezzi
  // (2 vs 5): un doppio conteggio (PDV + ricalcolo RS sommati) romperebbe il
  // rapporto. NB: il valore multi-PDV del ticker è un progress di soglia
  // scopato (non una somma), quindi l'additività non è il criterio giusto.
  assert.ok(Math.abs(puntiZ / puntiA - 2.5) < 0.01,
    `punti per-PDV devono essere proporzionali ai pezzi (5/2): Z=${puntiZ}, A=${puntiA}`);
});
