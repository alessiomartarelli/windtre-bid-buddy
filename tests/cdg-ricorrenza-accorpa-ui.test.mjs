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

// Lista spese CdG: le occorrenze di una ricorrenza sono ACCORPATE in una sola
// riga con drill-down (chevron), colonne Tipo/Ricorrenza e totale = somma
// delle rate; le spese una tantum restano righe singole con "Una tantum".

const api = (session, method, path, body) =>
  jsonReq(`${BASE}${path}`, {
    method,
    headers: { Cookie: session.cookieHeader },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

test('lista spese: ricorrenze accorpate con drill-down', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cdg_ric_ui_test', fullName: 'Cdg Ric UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const rs = uniq('RS RicUI');
    const createRs = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: rs });
    assert.equal(createRs.status, 201, `create RS: ${JSON.stringify(createRs.body)}`);

    // Ricorrente mensile 01/2027..03/2027 = 3 rate da 1220 (1000 + IVA 22%).
    const crea = await api(session, 'POST', '/api/cdg/spese', {
      ragioneSociale: rs,
      descrizione: 'Affitto UI',
      imponibile: '1000.00',
      aliquotaIva: '22.00',
      dataPagamento: '2027-01-05',
      meseCompetenza: '2027-01',
      ricorrente: true,
      periodicita: 'mensile',
      cashFlowOffsetMesi: 0,
      dataInizioRicorrenza: '2027-01-05',
      dataFineRicorrenza: '2027-03-31',
    });
    assert.equal(crea.status, 201, `create ric: ${JSON.stringify(crea.body)}`);

    // Una tantum nello stesso periodo.
    const unaTantum = await api(session, 'POST', '/api/cdg/spese', {
      ragioneSociale: rs,
      descrizione: 'Spesa singola UI',
      imponibile: '500.00',
      aliquotaIva: '22.00',
      dataPagamento: '2027-02-10',
      meseCompetenza: '2027-02',
      ricorrente: false,
    });
    assert.equal(unaTantum.status, 201, `create una tantum: ${JSON.stringify(unaTantum.body)}`);
    const singolaId = unaTantum.body.id;

    const gidRow = await pool.query(
      `SELECT ricorrenza_id FROM cdg_spese
        WHERE organization_id = $1 AND descrizione = 'Affitto UI' LIMIT 1`,
      [session.orgId],
    );
    const gid = gidRow.rows[0].ricorrenza_id;
    assert.ok(gid, 'ricorrenza_id presente');

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/amministrazione#controllo`, { waitUntil: 'networkidle' });
    await page.getByTestId('tab-spese').click();

    // Riga gruppo: una sola, con info ricorrenza e totale = somma delle rate.
    const gruppo = page.getByTestId(`row-ricorrenza-${gid}`);
    await gruppo.waitFor({ timeout: 15000 });
    assert.equal(await page.getByTestId(`row-ricorrenza-${gid}`).count(), 1, 'una sola riga per la ricorrenza');
    const info = await page.getByTestId(`cell-ricorrenza-info-${gid}`).innerText();
    assert.ok(/Mensile/.test(info), `colonna Ricorrenza mostra la periodicità: ${info}`);
    assert.ok(/01\/2027/.test(info) && /03\/2027/.test(info), `colonna Ricorrenza mostra il periodo: ${info}`);
    const totale = await page.getByTestId(`cell-totale-gruppo-${gid}`).innerText();
    assert.ok(totale.replace(/[.\s\u00a0]/g, '').includes('3660'), `totale gruppo = somma rate (3x1220): ${totale}`);

    // Le singole occorrenze NON sono righe top-level finché non si espande.
    const occIds = await pool.query(
      `SELECT id FROM cdg_spese WHERE organization_id = $1 AND ricorrenza_id = $2`,
      [session.orgId, gid],
    );
    for (const r of occIds.rows) {
      assert.equal(await page.getByTestId(`row-spesa-${r.id}`).count(), 0, 'occorrenza nascosta prima del drill-down');
    }

    // Drill-down: click sulla riga gruppo espande le 3 rate.
    await gruppo.click();
    for (const r of occIds.rows) {
      await page.getByTestId(`row-spesa-${r.id}`).waitFor({ timeout: 5000 });
    }

    // Ordinamento per Totale: il gruppo si ordina per SOMMA delle rate
    // (3.660), quindi in discendente precede la una tantum (610).
    await page.getByTestId('sort-importo').click(); // asc? primo click = desc
    const ordine = await page.locator('[data-testid^="row-ricorrenza-"], [data-testid^="row-spesa-"]').evaluateAll(
      els => els.map(e => e.getAttribute('data-testid')),
    );
    const idxGruppo = ordine.indexOf(`row-ricorrenza-${gid}`);
    const idxSingola = ordine.indexOf(`row-spesa-${singolaId}`);
    assert.ok(idxGruppo >= 0 && idxSingola >= 0, `righe presenti: ${ordine.join(', ')}`);
    assert.ok(idxGruppo < idxSingola, `in ordinamento Totale desc il gruppo (somma 3660) precede la singola (610): ${ordine.join(', ')}`);

    // La spesa una tantum resta una riga normale con "Una tantum".
    const rigaSingola = page.getByTestId(`row-spesa-${singolaId}`);
    assert.equal(await rigaSingola.count(), 1, 'una tantum visibile come riga singola');
    const testoSingola = await rigaSingola.innerText();
    assert.ok(/Una tantum/.test(testoSingola), `colonna Tipo mostra Una tantum: ${testoSingola}`);
  } finally {
    if (browser) await browser.close();
    await cleanupOrg(pool, session.orgId);
    await pool.end();
  }
});
