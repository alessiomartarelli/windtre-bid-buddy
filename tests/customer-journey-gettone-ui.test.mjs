import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

// Test suite UI per l'espansione del dettaglio dell'Analisi gettoni
// (Task #194). Protegge da regressioni l'interazione di espansione/chiusura
// della riga PDV/addetto nella vista "Reportistica > Analisi gettoni" e
// l'isolamento per operatore di quella stessa vista.
//
// Perché serve un test UI e non solo logica pura: i builder gettone
// (`buildGettoneJourneys`, `simSaturationPct`, `gettoneDetailByKey`) sono già
// coperti dai test puri di `customer-journey-report.test.mjs`. Quello che NON
// è coperto è il rendering React: il toggle `useState` che apre/chiude la
// sotto-tabella in `AnalisiView` e la corretta proiezione delle colonne
// (Cliente / SIM attive / Piste attive / % saturazione / Fatturato). Una
// modifica accidentale a `AnalisiView` potrebbe rompere l'espansione o
// l'isolamento senza che nessun test puro se ne accorga.
//
// Strategia: signup crea un profilo `admin` + org (la route report richiede
// l'org). Seminiamo DIRETTAMENTE due journey con i loro item (mobile attiva +
// cross-sell) via SQL — è deterministico e dà pieno controllo su
// driver/stato/PDV/addetto, così i valori di saturazione/fatturato attesi
// sono prevedibili (il reconcile da BiSuite è già coperto altrove e la vista
// gettone consuma comunque l'output di `/api/customer-journeys/report`,
// identico nelle due strade). Iniettiamo il cookie di sessione nel browser
// Playwright e guidiamo la UI. Per l'isolamento mutiamo `role`/`bisuite_addetti`
// del profilo (la route rilegge il profilo ad ogni richiesta) e ricarichiamo
// la pagina. Cleanup completo del dev DB alla fine.

const BASE = process.env.FINPLAN_BASE_URL || 'http://localhost:5000';

// Driver/stato attesi -> 2 piste cross-sell per Mario (energia + fisso) e 1
// per Luigi (energia). gettoneForPiste: [0,20,30,40,100,120], CJ_MAX_PISTE=5.
// Mario: 2 piste => fatturato 30€, saturazione 2/5 = 40%.
// Luigi: 1 pista  => fatturato 20€, saturazione 1/5 = 20%.
const MARIO_ADDETTO = `MARIO ROSSI ${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const LUIGI_ADDETTO = `LUIGI VERDI ${crypto.randomBytes(3).toString('hex')}`.toUpperCase();

function uniq(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

async function jsonReq(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  let body = null;
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) body = await r.json().catch(() => null);
  else body = await r.text().catch(() => null);
  return { status: r.status, headers: r.headers, body };
}

// Estrae la prima coppia name=value dei cookie di sessione di Set-Cookie.
function pickSessionCookie(headers) {
  const sc = headers.getSetCookie?.() || headers.raw?.()['set-cookie'] || [];
  const arr = Array.isArray(sc) ? sc : [sc];
  const first = arr.map((c) => c.split(';')[0]).filter(Boolean)[0];
  assert.ok(first, 'no session cookie returned by signup');
  const eq = first.indexOf('=');
  return { name: first.slice(0, eq), value: first.slice(eq + 1) };
}

async function signup() {
  const email = `${uniq('cj_gettone_ui')}@example.com`;
  const r = await jsonReq(`${BASE}/api/auth/signup`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: 'Pa55word!',
      fullName: 'CJ Gettone UI Test',
      organizationName: uniq('CJGettoneUI'),
    }),
  });
  assert.equal(r.status, 201, `signup failed: ${JSON.stringify(r.body)}`);
  const cookie = pickSessionCookie(r.headers);
  const profileId = r.body?.id;
  const orgId = r.body?.organization?.id || r.body?.organizationId;
  assert.ok(profileId && orgId, `missing ids in signup response: ${JSON.stringify(r.body)}`);
  return { cookie, profileId, orgId };
}

// Crea una journey privata con N item. `items` = [{driver, state}], pdv/addetto
// per item presi dai parametri. Ritorna l'id (uuid) della journey.
async function seedJourney(pool, orgId, { customerKey, nome, addetto, pdv, items }) {
  const cj = await pool.query(
    `INSERT INTO customer_journeys (organization_id, customer_key, customer_type, nome, status, opened_at)
       VALUES ($1, $2, 'privato', $3, 'aperta', now())
     RETURNING id`,
    [orgId, customerKey, nome],
  );
  const journeyId = cj.rows[0].id;
  for (const it of items) {
    await pool.query(
      `INSERT INTO customer_journey_items
         (journey_id, organization_id, driver, addetto, state, data_inserimento, pdv_destinazione, importo)
       VALUES ($1, $2, $3, $4, $5, now(), $6, $7)`,
      [journeyId, orgId, it.driver, addetto, it.state, pdv, it.importo ?? null],
    );
  }
  return journeyId;
}

async function setRole(pool, profileId, role, addetti = []) {
  await pool.query(
    `UPDATE profiles SET role = $2, bisuite_addetti = $3::text[] WHERE id = $1`,
    [profileId, role, addetti],
  );
}

async function cleanup(pool, session) {
  for (const q of [
    [`DELETE FROM customer_journey_items WHERE organization_id = $1`, [session.orgId]],
    [`DELETE FROM customer_journeys WHERE organization_id = $1`, [session.orgId]],
    [`DELETE FROM profiles WHERE id = $1`, [session.profileId]],
    [`DELETE FROM organizations WHERE id = $1`, [session.orgId]],
  ]) {
    await pool.query(q[0], q[1]).catch(() => {});
  }
}

function newPool() {
  return import('pg').then((pgMod) => {
    const Pool = pgMod.default?.Pool || pgMod.Pool;
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for this test');
    return new Pool({ connectionString: process.env.DATABASE_URL });
  });
}

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const out = execSync('which chromium-browser || which chromium', { encoding: 'utf8' }).trim();
  assert.ok(out, 'chromium executable not found on PATH');
  return out;
}

// Apre la pagina Customer Journey autenticata con il cookie di sessione e
// naviga fino alla vista Analisi gettoni raggruppata per addetto.
async function openAnalisiByAddetto(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/customer-journey`, { waitUntil: 'networkidle' });
  // Reportistica -> Analisi gettoni -> raggruppa per Addetto.
  await page.getByTestId('tab-report').click();
  await page.getByTestId('button-report-tab-analisi').click();
  await page.getByTestId('button-gettone-dim-addetto').click();
  return page;
}

// ===========================================================================
// SCENARIO 1: admin — espansione/chiusura riga + sotto-tabella dettaglio.
// ===========================================================================
test('scenario 1: admin can expand a gettone row and see the saturation detail', async () => {
  const pool = await newPool();
  const session = await signup();
  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    const jMario = await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFMARIO').toUpperCase(),
      nome: 'Cliente Mario',
      addetto: MARIO_ADDETTO,
      pdv: 'PDV Milano',
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '50.00' },
        { driver: 'fisso', state: 'inserito', importo: '20.00' },
      ],
    });
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFLUIGI').toUpperCase(),
      nome: 'Cliente Luigi',
      addetto: LUIGI_ADDETTO,
      pdv: 'PDV Roma',
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '30.00' },
      ],
    });

    const context = await browser.newContext();
    await context.addCookies([
      { name: session.cookie.name, value: session.cookie.value, domain: 'localhost', path: '/' },
    ]);
    const page = await openAnalisiByAddetto(context);

    // Entrambe le righe addetto sono presenti.
    const marioRow = page.getByTestId(`row-gettone-${MARIO_ADDETTO}`);
    const luigiRow = page.getByTestId(`row-gettone-${LUIGI_ADDETTO}`);
    await marioRow.waitFor({ state: 'visible', timeout: 15000 });
    await luigiRow.waitFor({ state: 'visible', timeout: 15000 });

    // Valori aggregati attesi per la riga di Mario.
    assert.equal(
      (await page.getByTestId(`text-gettone-sim-${MARIO_ADDETTO}`).innerText()).trim(),
      '1', 'Mario row: 1 SIM attivata',
    );
    assert.equal(
      (await page.getByTestId(`text-gettone-clienti-${MARIO_ADDETTO}`).innerText()).trim(),
      '1', 'Mario row: 1 cliente',
    );
    assert.equal(
      (await page.getByTestId(`text-gettone-conprodotti-${MARIO_ADDETTO}`).innerText()).trim(),
      '1', 'Mario row: 1 cliente con cross-sell',
    );

    // Il dettaglio non è ancora aperto.
    assert.equal(
      await page.getByTestId(`row-gettone-detail-${MARIO_ADDETTO}`).count(),
      0, 'detail row must NOT exist before expanding',
    );

    // Espandi la riga di Mario.
    await marioRow.click();
    const detail = page.getByTestId(`row-gettone-detail-${MARIO_ADDETTO}`);
    await detail.waitFor({ state: 'visible', timeout: 10000 });

    // La sotto-tabella mostra la riga cliente con i valori attesi.
    const simRow = detail.getByTestId(`row-gettone-sim-${jMario}`);
    await simRow.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(
      (await detail.getByTestId(`text-gettone-sim-cliente-${jMario}`).innerText()).trim(),
      'Cliente Mario', 'detail row shows the customer name',
    );
    assert.equal(
      (await detail.getByTestId(`text-gettone-sim-saturazione-${jMario}`).innerText()).trim(),
      '40%', 'detail row shows 40% saturation (2/5 piste)',
    );
    // Verifica le intestazioni della sotto-tabella.
    const detailText = await detail.innerText();
    for (const h of ['Cliente', 'SIM attive', 'Piste attive', '% saturazione', 'Fatturato']) {
      assert.ok(detailText.includes(h), `detail table must include header "${h}"`);
    }
    assert.ok(detailText.includes('2/5'), 'detail row shows 2/5 piste attive');

    // Richiudi la riga: la sotto-tabella sparisce.
    await marioRow.click();
    await detail.waitFor({ state: 'detached', timeout: 10000 });
    assert.equal(
      await page.getByTestId(`row-gettone-detail-${MARIO_ADDETTO}`).count(),
      0, 'detail row must be removed after collapsing',
    );

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanup(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: operatore — vede SOLO i propri clienti nell'Analisi gettoni.
// ===========================================================================
test('scenario 2: operator sees only their own clients in the gettone analysis', async () => {
  const pool = await newPool();
  const session = await signup();
  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFMARIO').toUpperCase(),
      nome: 'Cliente Mario',
      addetto: MARIO_ADDETTO,
      pdv: 'PDV Milano',
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '50.00' },
        { driver: 'fisso', state: 'inserito', importo: '20.00' },
      ],
    });
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFLUIGI').toUpperCase(),
      nome: 'Cliente Luigi',
      addetto: LUIGI_ADDETTO,
      pdv: 'PDV Roma',
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '30.00' },
      ],
    });

    // L'operatore è associato SOLO all'addetto di Mario (match case-insensitive).
    await setRole(pool, session.profileId, 'operatore', [MARIO_ADDETTO.toLowerCase()]);

    const context = await browser.newContext();
    await context.addCookies([
      { name: session.cookie.name, value: session.cookie.value, domain: 'localhost', path: '/' },
    ]);
    const page = await openAnalisiByAddetto(context);

    // Vede la riga di Mario...
    await page.getByTestId(`row-gettone-${MARIO_ADDETTO}`).waitFor({ state: 'visible', timeout: 15000 });
    // ...e NON quella di Luigi (nessun leakage del tenant).
    assert.equal(
      await page.getByTestId(`row-gettone-${LUIGI_ADDETTO}`).count(),
      0, 'operator must NOT see Luigi gettone row',
    );

    // Solo una riga gettone totale presente.
    const allRows = await page.locator('[data-testid^="row-gettone-"]:not([data-testid^="row-gettone-detail-"]):not([data-testid^="row-gettone-sim-"])').count();
    assert.equal(allRows, 1, 'operator must see exactly one gettone row');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanup(pool, session);
    await pool.end().catch(() => {});
  }
});
