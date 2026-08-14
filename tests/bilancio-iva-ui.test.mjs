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

// Task #364: card "Bilancio IVA" nella Prima Nota IVA — per ogni Ragione
// Sociale confronta IVA a DEBITO (imposta sulle vendite BiSuite del periodo)
// con IVA a CREDITO (campo iva delle spese CdG con data pagamento nel
// periodo), con saldo = debito − credito e riga TOTALE.
//
// Scenari coperti:
//   - RS presente su entrambi i lati (join per nome normalizzato, anche con
//     casing/spazi diversi tra vendite e spese);
//   - RS solo vendite (credito 0) e RS solo spese (debito 0, "a credito");
//   - il debito ignora righe natura (imposta 0) e "da verificare";
//   - il credito somma il campo IVA (non il totale lordo della spesa).

const api = (session, method, path, body) =>
  jsonReq(`${BASE}${path}`, {
    method,
    headers: { Cookie: session.cookieHeader },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const YEAR = now.getFullYear();
const MONTH = now.getMonth() + 1;
// Giorno 10 del mese corrente: dentro il range Dal–Al di default
// (mese italiano corrente) e lontano dai bordi timezone.
const DATA_VENDITA = `${YEAR}-${pad(MONTH)}-10T10:00:00.000Z`;
const DATA_PAG = `${YEAR}-${pad(MONTH)}-10`;
const YM = `${YEAR}-${pad(MONTH)}`;

const flat = (s) => s.replace(/[\s\u00a0]/g, '');

// Inserisce una vendita BiSuite con gli articoli dati (raw_data.articoli).
async function insertSale(pool, orgId, ragioneSociale, articoli) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio, ragione_sociale, stato, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [orgId, bisuiteId, DATA_VENDITA, 'POS-1', 'Negozio Test', ragioneSociale, 'ATTIVO', JSON.stringify({ articoli })],
  );
}

// Articolo fiscale standard 22%: scontrino 122, imponibile 100 → imposta 22.
const artStandard22 = (descrizione) => ({
  tipo: 'P',
  descrizione,
  dettaglio: { importoScontrino: '122.00', importoImponibile: '100.00' },
});
// Riga natura (N2): imposta 0, non deve gonfiare il debito.
const artNatura = {
  tipo: 'P',
  descrizione: 'Esente N2',
  dettaglio: { importoScontrino: '50.00', importoImponibile: '50.00', natura: 'N2' },
};
// Riga "da verificare" (scontrino > 0, imponibile 0): imposta 0.
const artDaVerificare = {
  tipo: 'S',
  descrizione: 'Da verificare',
  dettaglio: { importoScontrino: '30.00', importoImponibile: '0' },
};

test('Bilancio IVA: debito vendite vs credito spese CdG per RS, con saldo e totale', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'bilancio_iva_ui', fullName: 'Bilancio IVA UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    // RS A: vendite + spese (join con casing/spazi diversi).
    // RS B: solo vendite. RS C: solo spese.
    const rsA = uniq('Alpha Srl');
    const rsB = uniq('Beta Srl');
    const rsC = uniq('Gamma Srl');

    // Vendite: A ha 1 articolo standard (imposta 22) + natura + da verificare
    // (che NON devono aumentare il debito); B ha 1 articolo standard (22).
    // Lato vendite il nome di A arriva con casing diverso e spazi doppi.
    const rsASalesName = `  ${rsA.toUpperCase().replace(' ', '  ')}`;
    await insertSale(pool, session.orgId, rsASalesName, [artStandard22('Prodotto A'), artNatura, artDaVerificare]);
    await insertSale(pool, session.orgId, rsB, [artStandard22('Prodotto B')]);

    // Spese CdG: A → imponibile 50 @22% = IVA 11; C → imponibile 100 @10% = IVA 10.
    for (const nome of [rsA, rsC]) {
      const r = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome });
      assert.equal(r.status, 201, `create RS ${nome}: ${JSON.stringify(r.body)}`);
    }
    const spese = [
      { rs: rsA, imp: '50.00', aliq: '22.00' },
      { rs: rsC, imp: '100.00', aliq: '10.00' },
    ];
    for (const s of spese) {
      const r = await api(session, 'POST', '/api/cdg/spese', {
        ragioneSociale: s.rs,
        descrizione: `Spesa bilancio ${s.rs}`,
        imponibile: s.imp,
        aliquotaIva: s.aliq,
        dataPagamento: DATA_PAG,
        meseCompetenza: YM,
        ricorrente: false,
      });
      assert.equal(r.status, 201, `create spesa ${s.rs}: ${JSON.stringify(r.body)}`);
    }
    // Spesa fuori periodo (mese scorso): NON deve entrare nel credito.
    const prev = MONTH === 1 ? `${YEAR - 1}-12` : `${YEAR}-${pad(MONTH - 1)}`;
    const fuori = await api(session, 'POST', '/api/cdg/spese', {
      ragioneSociale: rsA,
      descrizione: 'Spesa fuori periodo',
      imponibile: '999.00',
      aliquotaIva: '22.00',
      dataPagamento: `${prev}-05`,
      meseCompetenza: prev,
      ricorrente: false,
    });
    assert.equal(fuori.status, 201, `create spesa fuori periodo: ${JSON.stringify(fuori.body)}`);

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/amministrazione`, { waitUntil: 'networkidle' });

    // Apre la tab Prima Nota IVA (trigger visibile a seconda del layout).
    await page.locator('[data-testid^="tab-iva"]:visible').first().waitFor({ timeout: 20000 });
    await page.locator('[data-testid^="tab-iva"]:visible').first().click();
    const card = page.getByTestId('card-bilancio-iva');
    await card.waitFor({ timeout: 15000 });

    // Il nome mostrato per A è quello lato vendite (prima occorrenza),
    // solo trimmato (gli spazi interni restano come nel dato sorgente).
    const rsADisplay = rsASalesName.trim();

    // Attende che il credito CdG sia caricato (riga di C presente).
    await page.getByTestId(`row-bilancio-${rsC}`).waitFor({ timeout: 15000 });

    // --- RS A: entrambe le fonti, join normalizzato ---
    const rowA = flat(await page.getByTestId(`row-bilancio-${rsADisplay}`).innerText());
    assert.ok(rowA.includes('22,00'), `A: debito 22,00: ${rowA}`);
    assert.ok(rowA.includes('11,00'), `A: credito 11,00 (solo spesa nel periodo): ${rowA}`);
    assert.ok(rowA.includes('daversare'), `A: saldo positivo "da versare": ${rowA}`);
    assert.ok(!rowA.includes('1.218,78') && !rowA.includes('219,78'), `A: spesa fuori periodo esclusa: ${rowA}`);

    // --- RS B: solo vendite → credito 0, saldo 22 da versare ---
    const rowB = flat(await page.getByTestId(`row-bilancio-${rsB}`).innerText());
    assert.ok(rowB.includes('22,00'), `B: debito 22,00: ${rowB}`);
    assert.ok(rowB.includes('0,00'), `B: credito 0,00: ${rowB}`);
    assert.ok(rowB.includes('daversare'), `B: saldo "da versare": ${rowB}`);

    // --- RS C: solo spese → debito 0, saldo -10 a credito ---
    const rowC = flat(await page.getByTestId(`row-bilancio-${rsC}`).innerText());
    assert.ok(rowC.includes('10,00'), `C: credito 10,00: ${rowC}`);
    assert.ok(rowC.includes('acredito'), `C: saldo negativo "a credito": ${rowC}`);

    // --- Totali: debito 44, credito 21, saldo 23 ---
    assert.ok(flat(await page.getByTestId('bilancio-tot-debito').innerText()).includes('44,00'), 'totale debito 44,00');
    assert.ok(flat(await page.getByTestId('bilancio-tot-credito').innerText()).includes('21,00'), 'totale credito 21,00');
    assert.ok(flat(await page.getByTestId('bilancio-tot-saldo').innerText()).includes('23,00'), 'totale saldo 23,00');
  } finally {
    if (browser) await browser.close();
    await cleanupOrg(pool, session);
    await pool.end();
  }
});
