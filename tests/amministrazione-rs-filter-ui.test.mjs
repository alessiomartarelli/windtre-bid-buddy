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

// Task #468: filtro Ragione Sociale nella pagina Amministrazione.
// Due meccanismi:
//   - select-rs (barra filtri): filtra le vendite a monte, quindi i gruppi
//     per RS di Prima Nota Contabile/IVA e i loro totali;
//   - chip button-rs-<rs> (switcher sotto le tab): mostra solo il gruppo
//     della RS scelta senza rifiltrare le vendite.
//
// Copre:
//   - default "Tutte le RS": entrambi i gruppi RS con i rispettivi totali;
//   - chip button-rs-<RS_UNO>: resta solo il gruppo UNO, ritorno via
//     button-rs-all;
//   - select-rs su RS_DUE: solo gruppo DUE in Contabile (totali coerenti)
//     e solo rs-iva-header-<RS_DUE> in Prima Nota IVA;
//   - ritorno a "Tutte le RS": entrambi i gruppi ripristinati.

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
// Giorno 10 del mese corrente: dentro il range di default della pagina
// (mese corrente) e lontano dai bordi timezone.
const DATA_VENDITA = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-10T10:00:00.000Z`;

const flat = (s) => s.replace(/[\s\u00a0]/g, '');

const RS_UNO = 'RS AMM FILTRO UNO';
const RS_DUE = 'RS AMM FILTRO DUE';

// Articolo fiscale (tipo S) con IVA 22%: imponibile/scontrino espliciti,
// così i totali della Prima Nota IVA sono deterministici.
const artServizio22 = (imponibile, lordo) => ({
  tipo: 'S',
  categoria: { nome: 'SERVIZI' },
  tipologia: { nome: 'SERVIZIO' },
  descrizione: 'SERVIZIO TEST IVA 22',
  dettaglio: {
    prezzo: String(lordo),
    importoScontrino: String(lordo),
    importoImponibile: String(imponibile),
  },
});

async function insertSale(pool, orgId, { codicePos, nomeNegozio, ragioneSociale, totale, articoli }) {
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
      'ADD AMM TEST',
      'FINALIZZATA',
      totale,
      JSON.stringify({ articoli, pagamento: { contanti: totale } }),
    ],
  );
}

test('Amministrazione UI: il filtro Ragione Sociale filtra Prima Nota Contabile/IVA e totali', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'amm_rs', fullName: 'Amministrazione RS Filter UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('AMRA');
    const POS_B = uniq('AMRB');

    // 2 RS, un PDV/vendita ciascuna, importi distinti:
    //   RS UNO (PDV A): totale 100 €, articolo IVA 22% imponibile 10 / lordo 12,20
    //   RS DUE (PDV B): totale  50 €, articolo IVA 22% imponibile 20 / lordo 24,40
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio RS Alfa', ragioneSociale: RS_UNO, totale: '100.00',
      articoli: [artServizio22('10.00', '12.20')],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_B, nomeNegozio: 'Negozio RS Beta', ragioneSociale: RS_DUE, totale: '50.00',
      articoli: [artServizio22('20.00', '24.40')],
    });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/amministrazione`, { waitUntil: 'networkidle' });

    const rsSelect = page.getByTestId('select-rs');
    await rsSelect.waitFor({ timeout: 20000 });

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
    const groupCount = (rs) => page.getByTestId(`totals-totale-${rs}`).count();

    // ── Default: "Tutte le RS" = entrambi i gruppi coi rispettivi totali ──
    assert.equal((await rsSelect.innerText()).trim(), 'Tutte le RS', 'default: select-rs mostra "Tutte le RS"');
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

    // ── Chip button-rs-<RS_UNO>: resta solo il gruppo UNO ──
    await page.getByTestId(`button-rs-${RS_UNO}`).click();
    await page.waitForFunction(
      (rs) => !document.querySelector(`[data-testid="totals-totale-${rs}"]`),
      RS_DUE,
      { timeout: 15000 },
    );
    assert.equal(await groupCount(RS_UNO), 1, 'chip RS UNO: gruppo UNO presente');
    assert.equal(await groupCount(RS_DUE), 0, 'chip RS UNO: gruppo DUE nascosto');
    assert.equal(
      flat(await page.getByTestId(`totals-totale-${RS_UNO}`).innerText()),
      '100,00€',
      'chip RS UNO: totale 100,00 € invariato',
    );

    // ── Ritorno via button-rs-all ──
    await page.getByTestId('button-rs-all').click();
    await waitScontrini(RS_DUE, 1, 'chip "Tutte": gruppo DUE ripristinato');
    assert.equal(await groupCount(RS_UNO), 1, 'chip "Tutte": gruppo UNO presente');

    // ── select-rs su RS_DUE: le vendite di RS UNO spariscono a monte ──
    await rsSelect.click();
    await page.getByRole('option', { name: RS_DUE }).click();
    await page.waitForFunction(
      (rs) => !document.querySelector(`[data-testid="totals-totale-${rs}"]`),
      RS_UNO,
      { timeout: 15000 },
    );
    assert.equal((await rsSelect.innerText()).trim(), RS_DUE, 'select-rs mostra la RS scelta');
    assert.equal(await groupCount(RS_UNO), 0, 'filtro RS DUE: gruppo UNO escluso');
    await waitScontrini(RS_DUE, 1, 'filtro RS DUE: 1 scontrino');
    assert.equal(
      flat(await page.getByTestId(`totals-totale-${RS_DUE}`).innerText()),
      '50,00€',
      'filtro RS DUE: totale contabile 50,00 €',
    );
    const mainText = await page.locator('main').innerText();
    assert.ok(!mainText.includes('Negozio RS Alfa'), 'filtro RS DUE: PDV di RS UNO escluso');
    assert.ok(mainText.includes('Negozio RS Beta'), 'filtro RS DUE: PDV di RS DUE presente');

    // ── Prima Nota IVA con filtro attivo: solo il gruppo di RS DUE ──
    await page.locator('[data-testid^="tab-iva"]:visible').first().click();
    const ivaHeaderDue = page.getByTestId(`rs-iva-header-${RS_DUE}`);
    await ivaHeaderDue.waitFor({ timeout: 15000 });
    assert.equal(
      await page.getByTestId(`rs-iva-header-${RS_UNO}`).count(),
      0,
      'filtro RS DUE (IVA): header di RS UNO assente',
    );
    const iva22Row = page.locator('tr', { hasText: 'IVA 22%' }).first();
    await iva22Row.waitFor({ timeout: 15000 });
    const iva22 = flat(await iva22Row.innerText());
    assert.ok(iva22.includes('IVA22%1'), `filtro RS DUE: 1 pezzo IVA 22% (${iva22})`);
    assert.ok(iva22.includes('20,00€'), `filtro RS DUE: imponibile 20,00 € (${iva22})`);
    assert.ok(iva22.includes('4,40€'), `filtro RS DUE: imposta 4,40 € (${iva22})`);
    assert.ok(iva22.includes('24,40€'), `filtro RS DUE: lordo 24,40 € (${iva22})`);

    // ── Ritorno a "Tutte le RS": entrambi i gruppi IVA ripristinati ──
    await rsSelect.click();
    await page.getByRole('option', { name: 'Tutte le RS' }).click();
    await page.getByTestId(`rs-iva-header-${RS_UNO}`).waitFor({ timeout: 15000 });
    assert.equal(await page.getByTestId(`rs-iva-header-${RS_DUE}`).count(), 1, 'tutte le RS (IVA): gruppo DUE presente');

    // Contabile: totali completi ripristinati.
    await page.locator('[data-testid^="tab-contabile"]:visible').first().click();
    await waitScontrini(RS_UNO, 1, 'tutte le RS: gruppo UNO ripristinato');
    await waitScontrini(RS_DUE, 1, 'tutte le RS: gruppo DUE ripristinato');
    assert.equal(
      flat(await page.getByTestId(`totals-totale-${RS_UNO}`).innerText()),
      '100,00€',
      'tutte le RS: totale RS UNO 100,00 €',
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
