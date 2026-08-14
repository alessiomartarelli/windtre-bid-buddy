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
