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
