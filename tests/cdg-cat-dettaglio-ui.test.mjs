import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  uniq,
  jsonReq,
  signup,
  setRole,
  cleanupOrg,
  newPool,
  launchBrowser,
  newAuthedContext,
} from './helpers/uiTest.mjs';

// Task #359: il drill-down "dettaglio spese di una categoria" (dialog
// data-testid="dialog-cat-dettaglio") deve mostrare SEMPRE le stesse spese
// dell'aggregato cliccato, in entrambe le viste (competenza/cassa) e con
// periodo mese vs anno. Le spese seminate hanno mese pagamento ≠ mese
// competenza (anche a cavallo d'anno), così una regressione nella logica
// periodo/vista farebbe divergere righe e totale del dialog dall'aggregato.
//
// Punti di apertura verificati:
//   - legenda della torta categorie (legend-cat-*): periodo = mese selezionato;
//   - riga del riepilogo categoria × RS (row-summary-*): periodo = anno o mese
//     a seconda del toggle pivot.

const api = (session, method, path, body) =>
  jsonReq(`${BASE}${path}`, {
    method,
    headers: { Cookie: session.cookieHeader },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const now = new Date();
const YEAR = now.getFullYear();
const MONTH = now.getMonth() + 1; // la torta parte dal mese corrente
const pad = (n) => String(n).padStart(2, '0');
const ym1 = `${YEAR}-${pad(MONTH)}`; // mese selezionato di default nella torta
// Un altro mese dello stesso anno (mai uguale a ym1).
const otherMonth = MONTH === 1 ? 2 : MONTH - 1;
const ym2 = `${YEAR}-${pad(otherMonth)}`;
const prevDec = `${YEAR - 1}-12`; // fuori anno (per la vista che non lo include)

// Normalizza il testo per confronti sugli importi it-IT (niente spazi/nbsp).
const flat = (s) => s.replace(/[\s\u00a0]/g, '');

async function openAndReadDialog(page, triggerTestId) {
  await page.getByTestId(triggerTestId).click();
  const dialog = page.getByTestId('dialog-cat-dettaglio');
  await dialog.waitFor({ timeout: 10000 });
  const text = await dialog.innerText();
  const rowIds = await dialog
    .locator('[data-testid^="row-cat-dettaglio-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('row-cat-dettaglio-', '')));
  return { dialog, text, rowIds };
}

async function closeDialog(page) {
  await page.keyboard.press('Escape');
  await page.getByTestId('dialog-cat-dettaglio').waitFor({ state: 'detached', timeout: 10000 });
}

test('drill-down categoria: righe e totale del dialog coerenti con l\'aggregato cliccato (competenza/cassa, mese/anno)', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cdg_catdet_ui', fullName: 'Cdg CatDet UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const rs = uniq('RS CatDet');
    const createRs = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: rs });
    assert.equal(createRs.status, 201, `create RS: ${JSON.stringify(createRs.body)}`);

    const cat = await api(session, 'POST', '/api/cdg/categorie', {
      nome: uniq('CatDettaglio UI'), ragioniSociali: [rs],
    });
    assert.equal(cat.status, 201, `create cat: ${JSON.stringify(cat.body)}`);
    const catId = cat.body.id;

    // Spese con mese pagamento ≠ mese competenza (E anche a cavallo d'anno):
    //   A: comp ym1,     pag ym2     → 100
    //   B: comp ym2,     pag ym1     → 250
    //   C: comp ym1,     pag ym1     →  60
    //   E: comp prevDec, pag ym1     →  70 (fuori anno per competenza)
    // Aggregati attesi:
    //   competenza mese ym1 (torta)  : A+C       = 160 (2 spese)
    //   cassa mese ym1 (torta)       : B+C+E     = 380 (3 spese)
    //   competenza anno (riepilogo)  : A+B+C     = 410 (3 spese, E esclusa)
    //   cassa anno (riepilogo)       : A+B+C+E   = 480 (4 spese)
    const seed = [
      { key: 'A', comp: ym1, pag: ym2, imp: '100.00' },
      { key: 'B', comp: ym2, pag: ym1, imp: '250.00' },
      { key: 'C', comp: ym1, pag: ym1, imp: '60.00' },
      { key: 'E', comp: prevDec, pag: ym1, imp: '70.00' },
    ];
    const ids = {};
    for (const s of seed) {
      const r = await api(session, 'POST', '/api/cdg/spese', {
        ragioneSociale: rs,
        descrizione: `Spesa ${s.key} catdet`,
        categoriaId: catId,
        imponibile: s.imp,
        aliquotaIva: '22.00',
        dataPagamento: `${s.pag}-05`,
        meseCompetenza: s.comp,
        ricorrente: false,
      });
      assert.equal(r.status, 201, `create spesa ${s.key}: ${JSON.stringify(r.body)}`);
      ids[s.key] = r.body.id;
    }

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/amministrazione#controllo`, { waitUntil: 'networkidle' });
    await page.getByTestId('row-summary-0').waitFor({ timeout: 15000 });

    // --- 1) Legenda torta, vista COMPETENZA, mese corrente (ym1) ---
    // Aggregato in legenda = 160; il dialog deve replicare esattamente.
    const legendText = flat(await page.getByTestId('legend-cat-0').innerText());
    assert.ok(legendText.includes('160,00'), `legenda mostra 160,00: ${legendText}`);
    {
      const { text, rowIds } = await openAndReadDialog(page, 'legend-cat-0');
      assert.ok(text.includes('per competenza'), `dialog in vista competenza: ${text}`);
      assert.ok(text.includes('2 spese'), `2 spese nel dialog: ${text}`);
      assert.ok(flat(text).includes('160,00'), `totale dialog = 160,00: ${text}`);
      assert.deepEqual(rowIds.sort(), [ids.A, ids.C].sort(), 'righe = A + C (competenza nel mese)');
      await closeDialog(page);
    }

    // --- 2) Legenda torta, vista CASSA, stesso mese ---
    await page.getByTestId('btn-vista-cassa').click();
    await page.getByTestId('legend-cat-0').waitFor({ timeout: 10000 });
    const legendCassa = flat(await page.getByTestId('legend-cat-0').innerText());
    assert.ok(legendCassa.includes('380,00'), `legenda cassa mostra 380,00: ${legendCassa}`);
    {
      const { text, rowIds } = await openAndReadDialog(page, 'legend-cat-0');
      assert.ok(text.includes('per cassa'), `dialog in vista cassa: ${text}`);
      assert.ok(text.includes('3 spese'), `3 spese nel dialog: ${text}`);
      assert.ok(flat(text).includes('380,00'), `totale dialog = 380,00: ${text}`);
      assert.deepEqual(rowIds.sort(), [ids.B, ids.C, ids.E].sort(), 'righe = B + C + E (pagate nel mese)');
      await closeDialog(page);
    }

    // --- 3) Riepilogo categoria × RS, periodo ANNO, vista CASSA ---
    // (siamo già in cassa; il riepilogo segue il periodo della pivot = Anno)
    {
      const rowText = flat(await page.getByTestId('row-summary-0').innerText());
      assert.ok(rowText.includes('480,00'), `riga riepilogo cassa/anno = 480,00: ${rowText}`);
      const { text, rowIds } = await openAndReadDialog(page, 'row-summary-0');
      assert.ok(text.includes(`anno ${YEAR}`), `periodo dialog = anno: ${text}`);
      assert.ok(text.includes('per cassa'), `dialog in vista cassa: ${text}`);
      assert.ok(text.includes('4 spese'), `4 spese nel dialog: ${text}`);
      assert.ok(flat(text).includes('480,00'), `totale dialog = 480,00: ${text}`);
      assert.deepEqual(rowIds.sort(), [ids.A, ids.B, ids.C, ids.E].sort(), 'righe = tutte le pagate nell\'anno');
      await closeDialog(page);
    }

    // --- 4) Riepilogo categoria × RS, periodo ANNO, vista COMPETENZA ---
    await page.getByTestId('btn-vista-competenza').click();
    await page.getByTestId('row-summary-0').waitFor({ timeout: 10000 });
    {
      const rowText = flat(await page.getByTestId('row-summary-0').innerText());
      assert.ok(rowText.includes('410,00'), `riga riepilogo competenza/anno = 410,00: ${rowText}`);
      const { text, rowIds } = await openAndReadDialog(page, 'row-summary-0');
      assert.ok(text.includes(`anno ${YEAR}`), `periodo dialog = anno: ${text}`);
      assert.ok(text.includes('per competenza'), `dialog in vista competenza: ${text}`);
      assert.ok(text.includes('3 spese'), `3 spese nel dialog: ${text}`);
      assert.ok(flat(text).includes('410,00'), `totale dialog = 410,00: ${text}`);
      assert.deepEqual(rowIds.sort(), [ids.A, ids.B, ids.C].sort(), 'E (competenza anno prima) esclusa');
      await closeDialog(page);
    }

    // --- 5) Riepilogo categoria × RS, periodo MESE (ym1), vista COMPETENZA ---
    const mesiFull = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
      'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    await page.getByTestId('btn-pivot-mese').click();
    await page.getByTestId('select-pivot-mese').click();
    await page.getByRole('option', { name: mesiFull[MONTH - 1], exact: true }).click();
    await page.getByTestId('row-summary-0').waitFor({ timeout: 10000 });
    {
      const rowText = flat(await page.getByTestId('row-summary-0').innerText());
      assert.ok(rowText.includes('160,00'), `riga riepilogo competenza/mese = 160,00: ${rowText}`);
      const { text, rowIds } = await openAndReadDialog(page, 'row-summary-0');
      assert.ok(text.includes('2 spese'), `2 spese nel dialog: ${text}`);
      assert.ok(flat(text).includes('160,00'), `totale dialog = 160,00: ${text}`);
      assert.deepEqual(rowIds.sort(), [ids.A, ids.C].sort(), 'righe = competenza nel mese selezionato');
      await closeDialog(page);
    }
  } finally {
    if (browser) await browser.close();
    await cleanupOrg(pool, session);
    await pool.end();
  }
});

// Task #361: come sopra ma per il filtro PDV della toolbar. Il memo `spese`
// confronta s.pdvCodice con il codice selezionato (select-filter-pdv), che
// richiede PDV validi per la RS (ereditati da organization_config o manuali
// via /api/cdg/pdv-manuali). Qui seminiamo due PDV manuali + una spesa senza
// PDV e verifichiamo che legenda torta, riga riepilogo e dialog escludano le
// spese degli altri PDV (e quelle senza PDV) quando il filtro è attivo.
test('drill-down categoria: legenda, riepilogo e dialog rispettano il filtro PDV della toolbar', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cdg_catdet_pdv', fullName: 'Cdg CatDet Pdv Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const rs = uniq('RS CatDetPdv');
    const createRs = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: rs });
    assert.equal(createRs.status, 201, `create RS: ${JSON.stringify(createRs.body)}`);

    const cat = await api(session, 'POST', '/api/cdg/categorie', {
      nome: uniq('CatDetPdv UI'), ragioniSociali: [rs],
    });
    assert.equal(cat.status, 201, `create cat: ${JSON.stringify(cat.body)}`);
    const catId = cat.body.id;

    // Due PDV manuali (validi per la RS) con codici diversi.
    const pdv1Codice = uniq('P1');
    const pdv1Nome = uniq('Negozio Uno');
    const pdv2Codice = uniq('P2');
    const pdv2Nome = uniq('Negozio Due');
    const pdv1 = await api(session, 'POST', '/api/cdg/pdv-manuali', {
      codice: pdv1Codice, nome: pdv1Nome, ragioneSociale: rs,
    });
    assert.equal(pdv1.status, 201, `create pdv 1: ${JSON.stringify(pdv1.body)}`);
    const pdv2 = await api(session, 'POST', '/api/cdg/pdv-manuali', {
      codice: pdv2Codice, nome: pdv2Nome, ragioneSociale: rs,
    });
    assert.equal(pdv2.status, 201, `create pdv 2: ${JSON.stringify(pdv2.body)}`);

    // Tutte le spese nel mese corrente (comp = pag = ym1):
    //   A: 100, PDV1
    //   B: 200, PDV2
    //   C:  50, senza PDV (costi generali)
    // Attesi (netto IVA):
    //   nessun filtro : A+B+C = 350 (3 spese)
    //   PDV = PDV1    : A     = 100 (1 spesa; B e C escluse)
    const seed = [
      { key: 'A', imp: '100.00', pdvCodice: pdv1Codice },
      { key: 'B', imp: '200.00', pdvCodice: pdv2Codice },
      { key: 'C', imp: '50.00', pdvCodice: null },
    ];
    const ids = {};
    for (const s of seed) {
      const r = await api(session, 'POST', '/api/cdg/spese', {
        ragioneSociale: rs,
        descrizione: `Spesa ${s.key} catdetpdv`,
        categoriaId: catId,
        pdvCodice: s.pdvCodice,
        imponibile: s.imp,
        aliquotaIva: '22.00',
        dataPagamento: `${ym1}-05`,
        meseCompetenza: ym1,
        ricorrente: false,
      });
      assert.equal(r.status, 201, `create spesa ${s.key}: ${JSON.stringify(r.body)}`);
      ids[s.key] = r.body.id;
    }

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/amministrazione#controllo`, { waitUntil: 'networkidle' });
    await page.getByTestId('row-summary-0').waitFor({ timeout: 15000 });

    // --- Baseline senza filtri: tutte le spese ovunque ---
    await waitForFlatText(page, 'legend-cat-0', '350,00');
    {
      const { text, rowIds } = await openAndReadDialog(page, 'legend-cat-0');
      assert.ok(text.includes('3 spese'), `baseline: 3 spese nel dialog: ${text}`);
      assert.ok(flat(text).includes('350,00'), `baseline: totale dialog = 350,00: ${text}`);
      assert.deepEqual(rowIds.sort(), [ids.A, ids.B, ids.C].sort(), 'baseline: tutte le spese');
      await closeDialog(page);
    }

    // --- Filtro PDV = PDV1: restano solo le spese con quel pdvCodice ---
    // Filtro PDV multiselect: il popover resta aperto, chiudi con Escape.
    await page.getByTestId('select-filter-pdv').click();
    await page.getByRole('option', { name: pdv1Nome, exact: true }).click();
    await page.keyboard.press('Escape');
    await waitForFlatText(page, 'legend-cat-0', '100,00');
    {
      const legendText = flat(await page.getByTestId('legend-cat-0').innerText());
      assert.ok(legendText.includes('100,00'), `legenda con filtro PDV = 100,00: ${legendText}`);
      const { text, rowIds } = await openAndReadDialog(page, 'legend-cat-0');
      assert.ok(text.includes('1 spes'), `PDV1: 1 spesa nel dialog: ${text}`);
      assert.ok(flat(text).includes('100,00'), `PDV1: totale dialog = 100,00: ${text}`);
      assert.deepEqual(rowIds, [ids.A], 'PDV1: solo A nel dialog');
      assert.ok(!rowIds.includes(ids.B), 'la spesa dell\'altro PDV non appare nel dialog');
      assert.ok(!rowIds.includes(ids.C), 'la spesa senza PDV non appare nel dialog');
      await closeDialog(page);
    }

    // Anche la riga del riepilogo categoria × RS (periodo anno) riflette
    // il filtro PDV: 100 e stessa riga nel dialog.
    await waitForFlatText(page, 'row-summary-0', '100,00');
    {
      const { text, rowIds } = await openAndReadDialog(page, 'row-summary-0');
      assert.ok(flat(text).includes('100,00'), `riepilogo con filtro PDV: totale = 100,00: ${text}`);
      assert.deepEqual(rowIds, [ids.A], 'riepilogo: solo A con il filtro PDV');
      await closeDialog(page);
    }

    // --- Filtro PDV = PDV2: solo B ---
    // Multiselect: deseleziona PDV1 e seleziona PDV2 (una selezione in più
    // si sommerebbe, non sostituirebbe).
    await page.getByTestId('select-filter-pdv').click();
    await page.getByRole('option', { name: pdv1Nome, exact: true }).click();
    await page.getByRole('option', { name: pdv2Nome, exact: true }).click();
    await page.keyboard.press('Escape');
    await waitForFlatText(page, 'legend-cat-0', '200,00');
    {
      const { rowIds } = await openAndReadDialog(page, 'legend-cat-0');
      assert.deepEqual(rowIds, [ids.B], 'PDV2: solo B nel dialog');
      await closeDialog(page);
    }

    // --- Reset filtri: tutto torna visibile ---
    await page.getByTestId('button-reset-filters').click();
    await waitForFlatText(page, 'legend-cat-0', '350,00');
    {
      const { rowIds } = await openAndReadDialog(page, 'legend-cat-0');
      assert.deepEqual(rowIds.sort(), [ids.A, ids.B, ids.C].sort(), 'reset: tutte le spese di nuovo nel dialog');
      await closeDialog(page);
    }
  } finally {
    if (browser) await browser.close();
    await cleanupOrg(pool, session);
    await pool.end();
  }
});

// Task #362: come sopra ma per il filtro Ragione Sociale (server-side: param
// `rs` della query /api/cdg/spese) e per il filtro "Mese pagamento"
// (client-side sul prefisso YYYY-MM di dataPagamento nel memo `spese`).
// Semina due RS con spese distinte sulla stessa categoria + spese con mesi
// pagamento diversi, e verifica che legenda torta, riga riepilogo e dialog
// escludano le spese fuori filtro (anche coi filtri combinati).
test('drill-down categoria: legenda, riepilogo e dialog rispettano i filtri RS e mese pagamento', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cdg_catdet_rs', fullName: 'Cdg CatDet Rs Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const rs1 = uniq('RS CatDetUno');
    const rs2 = uniq('RS CatDetDue');
    for (const nome of [rs1, rs2]) {
      const r = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome });
      assert.equal(r.status, 201, `create RS ${nome}: ${JSON.stringify(r.body)}`);
    }

    // Un'unica categoria condivisa fra le due RS: legend-cat-0 aggrega
    // entrambe finché il filtro RS non è attivo.
    const cat = await api(session, 'POST', '/api/cdg/categorie', {
      nome: uniq('CatDetRs UI'), ragioniSociali: [rs1, rs2],
    });
    assert.equal(cat.status, 201, `create cat: ${JSON.stringify(cat.body)}`);
    const catId = cat.body.id;

    // Tutte le spese con competenza ym1 (la torta parte dal mese corrente);
    // il mese di PAGAMENTO varia per esercitare filterMesePagamento:
    //   A: rs1, pag ym1, 110
    //   B: rs1, pag ym2,  40
    //   C: rs2, pag ym1, 200
    // Attesi (netto IVA, vista competenza mese ym1):
    //   nessun filtro          : A+B+C = 350 (3 spese)
    //   RS = rs1               : A+B   = 150 (2 spese; C esclusa)
    //   RS = rs1 + pag = ym1   : A     = 110 (B esclusa: pagata in ym2)
    //   solo pag = ym2         : B     =  40 (A e C escluse)
    const seed = [
      { key: 'A', rs: rs1, pag: ym1, imp: '110.00' },
      { key: 'B', rs: rs1, pag: ym2, imp: '40.00' },
      { key: 'C', rs: rs2, pag: ym1, imp: '200.00' },
    ];
    const ids = {};
    for (const s of seed) {
      const r = await api(session, 'POST', '/api/cdg/spese', {
        ragioneSociale: s.rs,
        descrizione: `Spesa ${s.key} catdetrs`,
        categoriaId: catId,
        imponibile: s.imp,
        aliquotaIva: '22.00',
        dataPagamento: `${s.pag}-05`,
        meseCompetenza: ym1,
        ricorrente: false,
      });
      assert.equal(r.status, 201, `create spesa ${s.key}: ${JSON.stringify(r.body)}`);
      ids[s.key] = r.body.id;
    }

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/amministrazione#controllo`, { waitUntil: 'networkidle' });
    await page.getByTestId('row-summary-0').waitFor({ timeout: 15000 });

    // --- Baseline senza filtri: entrambe le RS nella legenda e nel dialog ---
    await waitForFlatText(page, 'legend-cat-0', '350,00');
    {
      const { text, rowIds } = await openAndReadDialog(page, 'legend-cat-0');
      assert.ok(text.includes('3 spese'), `baseline: 3 spese nel dialog: ${text}`);
      assert.ok(flat(text).includes('350,00'), `baseline: totale dialog = 350,00: ${text}`);
      assert.deepEqual(rowIds.sort(), [ids.A, ids.B, ids.C].sort(), 'baseline: spese di entrambe le RS');
      await closeDialog(page);
    }

    // --- Filtro RS = rs1 (server-side): le spese di rs2 spariscono ovunque ---
    await page.getByTestId('select-filter-rs').click();
    await page.getByRole('option', { name: rs1, exact: true }).click();
    await page.keyboard.press('Escape');
    await waitForFlatText(page, 'legend-cat-0', '150,00');
    {
      const { text, rowIds } = await openAndReadDialog(page, 'legend-cat-0');
      assert.ok(text.includes('2 spese'), `RS filtro: 2 spese nel dialog: ${text}`);
      assert.ok(flat(text).includes('150,00'), `RS filtro: totale dialog = 150,00: ${text}`);
      assert.deepEqual(rowIds.sort(), [ids.A, ids.B].sort(), 'RS filtro: solo le spese di rs1');
      assert.ok(!rowIds.includes(ids.C), 'la spesa dell\'altra RS non appare nel dialog');
      await closeDialog(page);
    }

    // Anche la riga del riepilogo categoria × RS (periodo anno) riflette il
    // filtro RS: una sola riga (rs1), 150, stesse righe nel dialog.
    await waitForFlatText(page, 'row-summary-0', '150,00');
    {
      const rowText = await page.getByTestId('row-summary-0').innerText();
      assert.ok(rowText.includes(rs1), `riga riepilogo = rs1: ${rowText}`);
      const rows2 = await page.getByTestId('row-summary-1').count();
      assert.equal(rows2, 0, 'nessuna seconda riga di riepilogo con il filtro RS attivo');
      const { text, rowIds } = await openAndReadDialog(page, 'row-summary-0');
      assert.ok(flat(text).includes('150,00'), `riepilogo con filtro RS: totale = 150,00: ${text}`);
      assert.deepEqual(rowIds.sort(), [ids.A, ids.B].sort(), 'riepilogo: solo le spese di rs1');
      await closeDialog(page);
    }

    // --- Filtro combinato: RS = rs1 + mese pagamento = ym1 ---
    // B (pagata in ym2) sparisce anche se la competenza è nel mese.
    await page.getByTestId('input-filter-pagamento').fill(ym1);
    await waitForFlatText(page, 'legend-cat-0', '110,00');
    {
      const { text, rowIds } = await openAndReadDialog(page, 'legend-cat-0');
      assert.ok(text.includes('1 spes'), `RS+pag: 1 spesa nel dialog: ${text}`);
      assert.ok(flat(text).includes('110,00'), `RS+pag: totale dialog = 110,00: ${text}`);
      assert.deepEqual(rowIds, [ids.A], 'RS+pag: solo A nel dialog');
      await closeDialog(page);
    }
    await waitForFlatText(page, 'row-summary-0', '110,00');
    {
      const { text, rowIds } = await openAndReadDialog(page, 'row-summary-0');
      assert.deepEqual(rowIds, [ids.A], 'riepilogo con filtri combinati: solo A');
      assert.ok(flat(text).includes('110,00'), `riepilogo filtri combinati: totale = 110,00: ${text}`);
      await closeDialog(page);
    }

    // --- Reset filtri: tutto torna visibile ---
    await page.getByTestId('button-reset-filters').click();
    await waitForFlatText(page, 'legend-cat-0', '350,00');
    {
      const { rowIds } = await openAndReadDialog(page, 'legend-cat-0');
      assert.deepEqual(rowIds.sort(), [ids.A, ids.B, ids.C].sort(), 'reset: tutte le spese di nuovo nel dialog');
      await closeDialog(page);
    }

    // --- Solo mese pagamento = ym2 (client-side, senza filtro RS) ---
    // Resta solo B: A e C sono pagate in ym1.
    await page.getByTestId('input-filter-pagamento').fill(ym2);
    await waitForFlatText(page, 'legend-cat-0', '40,00');
    {
      const { text, rowIds } = await openAndReadDialog(page, 'legend-cat-0');
      assert.ok(text.includes('1 spes'), `pag=ym2: 1 spesa nel dialog: ${text}`);
      assert.ok(flat(text).includes('40,00'), `pag=ym2: totale dialog = 40,00: ${text}`);
      assert.deepEqual(rowIds, [ids.B], 'pag=ym2: solo B nel dialog');
      assert.ok(!rowIds.includes(ids.A) && !rowIds.includes(ids.C), 'le spese pagate in altri mesi non appaiono');
      await closeDialog(page);
    }
    await waitForFlatText(page, 'row-summary-0', '40,00');
    {
      const { rowIds } = await openAndReadDialog(page, 'row-summary-0');
      assert.deepEqual(rowIds, [ids.B], 'riepilogo con mese pagamento: solo B');
      await closeDialog(page);
    }
  } finally {
    if (browser) await browser.close();
    await cleanupOrg(pool, session);
    await pool.end();
  }
});

// Task #360: il dialog di drill-down deve rispettare anche i filtri attivi
// nella toolbar (fornitore, importo min/max, ...). Il memo `spese` riduce
// l'array client-side PRIMA di dashboard/pivot/dialog: qui verifichiamo che
// legenda torta, riga riepilogo e dialog restino coerenti tra loro ed
// escludano le spese filtrate quando si imposta un fornitore e/o un importo
// minimo. Una regressione (es. dialog che legge speseAll) farebbe divergere
// aggregati e dettaglio.

// Attende che l'elemento data-testid contenga la stringa (importi it-IT
// normalizzati senza spazi) — i filtri aggiornano il DOM in modo asincrono.
async function waitForFlatText(page, testId, needle) {
  await page.waitForFunction(
    ({ testId, needle }) => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      return !!el && el.innerText.replace(/[\s\u00a0]/g, '').includes(needle);
    },
    { testId, needle },
    { timeout: 10000 },
  );
}

test('drill-down categoria: legenda, riepilogo e dialog rispettano i filtri toolbar (fornitore + importo min)', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cdg_catdet_flt', fullName: 'Cdg CatDet Filtri Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const rs = uniq('RS CatDetFlt');
    const createRs = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: rs });
    assert.equal(createRs.status, 201, `create RS: ${JSON.stringify(createRs.body)}`);

    const cat = await api(session, 'POST', '/api/cdg/categorie', {
      nome: uniq('CatDetFlt UI'), ragioniSociali: [rs],
    });
    assert.equal(cat.status, 201, `create cat: ${JSON.stringify(cat.body)}`);
    const catId = cat.body.id;

    const forn1Nome = uniq('Fornitore F1');
    const forn2Nome = uniq('Fornitore F2');
    const forn1 = await api(session, 'POST', '/api/cdg/fornitori', { nome: forn1Nome, ragioniSociali: [rs] });
    assert.equal(forn1.status, 201, `create fornitore 1: ${JSON.stringify(forn1.body)}`);
    const forn2 = await api(session, 'POST', '/api/cdg/fornitori', { nome: forn2Nome, ragioniSociali: [rs] });
    assert.equal(forn2.status, 201, `create fornitore 2: ${JSON.stringify(forn2.body)}`);

    // Tutte le spese nel mese corrente (comp = pag = ym1), IVA 22%:
    //   A: imponibile 100 (tot 122,00), fornitore F1
    //   B: imponibile 200 (tot 244,00), fornitore F2
    //   C: imponibile  50 (tot  61,00), fornitore F1
    // Attesi (gli aggregati sono al NETTO IVA, il filtro importo confronta
    // il TOTALE registrato):
    //   nessun filtro            : A+B+C = 350 (3 spese)
    //   fornitore F1             : A+C   = 150 (2 spese)
    //   fornitore F1 + min 100   : A     = 100 (1 spesa; C esclusa: tot 61 < 100)
    const seed = [
      { key: 'A', imp: '100.00', fornitoreId: forn1.body.id },
      { key: 'B', imp: '200.00', fornitoreId: forn2.body.id },
      { key: 'C', imp: '50.00', fornitoreId: forn1.body.id },
    ];
    const ids = {};
    for (const s of seed) {
      const r = await api(session, 'POST', '/api/cdg/spese', {
        ragioneSociale: rs,
        descrizione: `Spesa ${s.key} catdetflt`,
        categoriaId: catId,
        fornitoreId: s.fornitoreId,
        imponibile: s.imp,
        aliquotaIva: '22.00',
        dataPagamento: `${ym1}-05`,
        meseCompetenza: ym1,
        ricorrente: false,
      });
      assert.equal(r.status, 201, `create spesa ${s.key}: ${JSON.stringify(r.body)}`);
      ids[s.key] = r.body.id;
    }

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/amministrazione#controllo`, { waitUntil: 'networkidle' });
    await page.getByTestId('row-summary-0').waitFor({ timeout: 15000 });

    // --- Baseline senza filtri: legenda torta = 350 (competenza, ym1) ---
    await waitForFlatText(page, 'legend-cat-0', '350,00');
    {
      const { text, rowIds } = await openAndReadDialog(page, 'legend-cat-0');
      assert.ok(text.includes('3 spese'), `baseline: 3 spese nel dialog: ${text}`);
      assert.ok(flat(text).includes('350,00'), `baseline: totale dialog = 350,00: ${text}`);
      assert.deepEqual(rowIds.sort(), [ids.A, ids.B, ids.C].sort(), 'baseline: tutte le spese');
      await closeDialog(page);
    }

    // --- Filtro fornitore = F1: B sparisce ovunque ---
    await page.getByTestId('select-filter-fornitore').click();
    await page.getByRole('option', { name: forn1Nome, exact: true }).click();
    await page.keyboard.press('Escape');
    await waitForFlatText(page, 'legend-cat-0', '150,00');
    {
      const legendText = flat(await page.getByTestId('legend-cat-0').innerText());
      assert.ok(legendText.includes('150,00'), `legenda con filtro fornitore = 150,00: ${legendText}`);
      const { text, rowIds } = await openAndReadDialog(page, 'legend-cat-0');
      assert.ok(text.includes('2 spese'), `fornitore F1: 2 spese nel dialog: ${text}`);
      assert.ok(flat(text).includes('150,00'), `fornitore F1: totale dialog = 150,00: ${text}`);
      assert.deepEqual(rowIds.sort(), [ids.A, ids.C].sort(), 'fornitore F1: B esclusa anche dal dialog');
      assert.ok(!rowIds.includes(ids.B), 'la spesa del fornitore filtrato non appare nel dialog');
      await closeDialog(page);
    }

    // Anche la riga del riepilogo categoria × RS (periodo anno) deve
    // riflettere il filtro fornitore: 150 e stesse righe nel dialog.
    await waitForFlatText(page, 'row-summary-0', '150,00');
    {
      const { text, rowIds } = await openAndReadDialog(page, 'row-summary-0');
      assert.ok(text.includes('2 spese'), `riepilogo con fornitore F1: 2 spese: ${text}`);
      assert.ok(flat(text).includes('150,00'), `riepilogo con fornitore F1: totale = 150,00: ${text}`);
      assert.deepEqual(rowIds.sort(), [ids.A, ids.C].sort(), 'riepilogo: stesse righe filtrate');
      await closeDialog(page);
    }

    // --- Filtro combinato: fornitore F1 + importo min 100 ---
    // Il filtro confronta il TOTALE registrato (122 vs 61): resta solo A.
    await page.getByTestId('input-filter-min').fill('100');
    await waitForFlatText(page, 'legend-cat-0', '100,00');
    {
      const { text, rowIds } = await openAndReadDialog(page, 'legend-cat-0');
      assert.ok(text.includes('1 spes'), `min 100: 1 spesa nel dialog: ${text}`);
      assert.ok(flat(text).includes('100,00'), `min 100: totale dialog = 100,00 (netto IVA): ${text}`);
      assert.deepEqual(rowIds, [ids.A], 'min 100: solo A nel dialog');
      await closeDialog(page);
    }
    await waitForFlatText(page, 'row-summary-0', '100,00');
    {
      const { text, rowIds } = await openAndReadDialog(page, 'row-summary-0');
      assert.deepEqual(rowIds, [ids.A], 'riepilogo con filtri combinati: solo A');
      assert.ok(flat(text).includes('100,00'), `riepilogo filtri combinati: totale = 100,00: ${text}`);
      await closeDialog(page);
    }

    // --- Reset filtri: tutto torna visibile ---
    await page.getByTestId('button-reset-filters').click();
    await waitForFlatText(page, 'legend-cat-0', '350,00');
    {
      const { rowIds } = await openAndReadDialog(page, 'legend-cat-0');
      assert.deepEqual(rowIds.sort(), [ids.A, ids.B, ids.C].sort(), 'reset: tutte le spese di nuovo nel dialog');
      await closeDialog(page);
    }
  } finally {
    if (browser) await browser.close();
    await cleanupOrg(pool, session);
    await pool.end();
  }
});
