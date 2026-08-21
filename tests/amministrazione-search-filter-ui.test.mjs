import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  uniq,
  signup,
  setRole,
  cleanupOrg,
  newPool,
  launchBrowser,
  newAuthedContext,
} from './helpers/uiTest.mjs';

// Task #469: casella "Cerca" (testid input-search) nella pagina Amministrazione.
// La ricerca libera filtra le vendite a monte (come i filtri PDV/RS): il
// matching avviene su codicePos, nomeNegozio, ragioneSociale, nomeAddetto,
// nomeCliente e bisuiteId (deferredSearch in Amministrazione.tsx).
//
// Copre:
//   - default (ricerca vuota): entrambi i gruppi RS con i rispettivi totali;
//   - ricerca per nome addetto: resta solo lo scontrino dell'addetto cercato
//     (gruppo RS coerente, totale invariato, PDV dell'altro escluso);
//   - ricerca per nome negozio dell'altro gruppo: switch al gruppo opposto;
//   - ricerca senza corrispondenze: nessun gruppo RS visibile;
//   - svuotamento della ricerca: entrambi i gruppi ripristinati.

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
// Giorno 10 del mese corrente: dentro il range di default della pagina
// (mese corrente) e lontano dai bordi timezone.
const DATA_VENDITA = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-10T10:00:00.000Z`;

const flat = (s) => s.replace(/[\s\u00a0]/g, '');

const RS_UNO = 'RS AMM CERCA UNO';
const RS_DUE = 'RS AMM CERCA DUE';
const ADDETTO_UNO = 'MARIO CERCATEST ROSSI';
const ADDETTO_DUE = 'LUCA CERCATEST BIANCHI';
const NEGOZIO_UNO = 'Negozio Cerca Alfa';
const NEGOZIO_DUE = 'Negozio Cerca Beta';

async function insertSale(pool, orgId, { codicePos, nomeNegozio, ragioneSociale, nomeAddetto, totale }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        ragione_sociale, nome_addetto, stato, totale, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      orgId,
      bisuiteId,
      DATA_VENDITA,
      codicePos,
      nomeNegozio,
      ragioneSociale,
      nomeAddetto,
      'FINALIZZATA',
      totale,
      JSON.stringify({ articoli: [], pagamento: { contanti: totale } }),
    ],
  );
}

test('Amministrazione UI: la casella Cerca filtra gli scontrini per addetto/negozio', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'amm_search', fullName: 'Amministrazione Search Filter UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('AMSA');
    const POS_B = uniq('AMSB');

    // 2 RS, un PDV/vendita ciascuna, addetti e negozi distinti:
    //   RS UNO (PDV A, ADDETTO UNO, Negozio Alfa): totale 100 €
    //   RS DUE (PDV B, ADDETTO DUE, Negozio Beta): totale  50 €
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: NEGOZIO_UNO, ragioneSociale: RS_UNO,
      nomeAddetto: ADDETTO_UNO, totale: '100.00',
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_B, nomeNegozio: NEGOZIO_DUE, ragioneSociale: RS_DUE,
      nomeAddetto: ADDETTO_DUE, totale: '50.00',
    });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/amministrazione`, { waitUntil: 'networkidle' });

    const searchInput = page.getByTestId('input-search');
    await searchInput.waitFor({ timeout: 20000 });

    const waitScontrini = async (rs, expected, label) => {
      await page.waitForFunction(
        ([r, exp]) =>
          document.querySelector(`[data-testid="totals-scontrini-${r}"]`)?.textContent?.trim() === exp,
        [rs, String(expected)],
        { timeout: 15000 },
      );
      assert.equal(
        (await page.getByTestId(`totals-scontrini-${rs}`).innerText()).trim(),
        String(expected),
        label,
      );
    };
    const waitGroupGone = (rs) =>
      page.waitForFunction(
        (r) => !document.querySelector(`[data-testid="totals-totale-${r}"]`),
        rs,
        { timeout: 15000 },
      );
    const groupCount = (rs) => page.getByTestId(`totals-totale-${rs}`).count();

    // ── Default: ricerca vuota = entrambi i gruppi coi rispettivi totali ──
    await waitScontrini(RS_UNO, 1, `default: 1 scontrino per ${RS_UNO}`);
    await waitScontrini(RS_DUE, 1, `default: 1 scontrino per ${RS_DUE}`);
    assert.equal(
      flat(await page.getByTestId(`totals-totale-${RS_UNO}`).innerText()),
      '100,00€',
      'default: totale contabile RS UNO = 100,00 €',
    );
    assert.equal(
      flat(await page.getByTestId(`totals-totale-${RS_DUE}`).innerText()),
      '50,00€',
      'default: totale contabile RS DUE = 50,00 €',
    );

    // ── Ricerca per addetto UNO: resta solo lo scontrino di RS UNO ──
    await searchInput.fill(ADDETTO_UNO.toLowerCase());
    await waitGroupGone(RS_DUE);
    assert.equal(await groupCount(RS_UNO), 1, 'ricerca addetto UNO: gruppo UNO presente');
    assert.equal(await groupCount(RS_DUE), 0, 'ricerca addetto UNO: gruppo DUE escluso');
    await waitScontrini(RS_UNO, 1, 'ricerca addetto UNO: 1 scontrino');
    assert.equal(
      flat(await page.getByTestId(`totals-totale-${RS_UNO}`).innerText()),
      '100,00€',
      'ricerca addetto UNO: totale 100,00 € invariato',
    );
    let mainText = await page.locator('main').innerText();
    assert.ok(!mainText.includes(NEGOZIO_DUE), 'ricerca addetto UNO: PDV di RS DUE escluso');
    assert.ok(mainText.includes(NEGOZIO_UNO), 'ricerca addetto UNO: PDV di RS UNO presente');

    // ── Ricerca per negozio DUE: switch al gruppo opposto ──
    await searchInput.fill(NEGOZIO_DUE);
    await waitGroupGone(RS_UNO);
    assert.equal(await groupCount(RS_DUE), 1, 'ricerca negozio DUE: gruppo DUE presente');
    assert.equal(await groupCount(RS_UNO), 0, 'ricerca negozio DUE: gruppo UNO escluso');
    await waitScontrini(RS_DUE, 1, 'ricerca negozio DUE: 1 scontrino');
    assert.equal(
      flat(await page.getByTestId(`totals-totale-${RS_DUE}`).innerText()),
      '50,00€',
      'ricerca negozio DUE: totale 50,00 €',
    );

    // ── Ricerca senza corrispondenze: nessun gruppo RS visibile ──
    await searchInput.fill('XYZNESSUNACORRISPONDENZA');
    await waitGroupGone(RS_DUE);
    assert.equal(await groupCount(RS_UNO), 0, 'ricerca vuota di risultati: gruppo UNO assente');
    assert.equal(await groupCount(RS_DUE), 0, 'ricerca vuota di risultati: gruppo DUE assente');

    // ── Svuotamento: entrambi i gruppi ripristinati ──
    await searchInput.fill('');
    await waitScontrini(RS_UNO, 1, 'ricerca svuotata: gruppo UNO ripristinato');
    await waitScontrini(RS_DUE, 1, 'ricerca svuotata: gruppo DUE ripristinato');
    assert.equal(
      flat(await page.getByTestId(`totals-totale-${RS_UNO}`).innerText()),
      '100,00€',
      'ricerca svuotata: totale RS UNO 100,00 €',
    );
    assert.equal(
      flat(await page.getByTestId(`totals-totale-${RS_DUE}`).innerText()),
      '50,00€',
      'ricerca svuotata: totale RS DUE 50,00 €',
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
