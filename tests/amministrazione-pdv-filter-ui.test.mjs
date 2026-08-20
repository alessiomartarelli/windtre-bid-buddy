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

// Task #467: filtro multi-PDV condiviso (MultiSelectFilter) nella pagina
// Amministrazione. Semantica: selezione vuota = tutti i PDV, selezioni = OR.
//
// Copre:
//   - default "Tutti i PDV": scontrini/totali su tutti e 3 i PDV seminati;
//   - selezione di 2 PDV (testid select-pdv, opzioni option-select-pdv-<codice>):
//     righe della Prima Nota Contabile e totali coerenti (solo A+B);
//   - Prima Nota IVA con filtro attivo: pezzi/imponibile/imposta/lordo
//     della riga "IVA 22%" limitati ai 2 PDV selezionati;
//   - ritorno a "Tutti i PDV" via option-select-pdv-all: totali completi.

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
// Giorno 10 del mese corrente: dentro il range di default della pagina
// (mese corrente) e lontano dai bordi timezone.
const DATA_VENDITA = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-10T10:00:00.000Z`;

const flat = (s) => s.replace(/[\s\u00a0]/g, '');

// Unica RS per tutte le vendite: i testid dei totali contabili sono
// per-RS (totals-scontrini-<rs>, totals-totale-<rs>).
const RS = 'RS AMM MULTIPDV';

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

async function insertSale(pool, orgId, { codicePos, nomeNegozio, totale, articoli }) {
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
      RS,
      'ADD AMM TEST',
      'FINALIZZATA',
      totale,
      JSON.stringify({ articoli, pagamento: { contanti: totale } }),
    ],
  );
}

test('Amministrazione UI: il filtro multi-PDV filtra Prima Nota Contabile/IVA e totali', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'amm_mpdv', fullName: 'Amministrazione MultiPDV UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('AMMA');
    const POS_B = uniq('AMMB');
    const POS_C = uniq('AMMC');

    // 3 PDV, una vendita ciascuno, importi distinti:
    //   A: totale 100 €, articolo IVA 22% imponibile 10 / lordo 12,20
    //   B: totale  50 €, articolo IVA 22% imponibile 20 / lordo 24,40
    //   C: totale  30 €, articolo IVA 22% imponibile 30 / lordo 36,60
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio Amm Alfa', totale: '100.00',
      articoli: [artServizio22('10.00', '12.20')],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_B, nomeNegozio: 'Negozio Amm Beta', totale: '50.00',
      articoli: [artServizio22('20.00', '24.40')],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_C, nomeNegozio: 'Negozio Amm Gamma', totale: '30.00',
      articoli: [artServizio22('30.00', '36.60')],
    });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/amministrazione`, { waitUntil: 'networkidle' });

    const trigger = page.getByTestId('select-pdv');
    await trigger.waitFor({ timeout: 20000 });

    const waitScontrini = async (expected, label) => {
      await page.waitForFunction(
        ([rs, exp]) =>
          document.querySelector(`[data-testid="totals-scontrini-${rs}"]`)?.textContent?.trim() === exp,
        [RS, String(expected)],
        { timeout: 15000 },
      );
      assert.equal(
        (await page.getByTestId(`totals-scontrini-${RS}`).innerText()).trim(),
        String(expected),
        label,
      );
    };
    // Righe della tabella contabile (aggregato giorno×PDV): i testid delle
    // righe dati iniziano con la data (row-contabile-20...), quello della
    // riga totali con row-contabile-totals-.
    const contabileDataRows = () => page.locator('[data-testid^="row-contabile-20"]');

    // ── Default: nessuna selezione = tutti i PDV ──
    assert.equal((await trigger.innerText()).trim(), 'Tutti i PDV', 'default: trigger mostra "Tutti i PDV"');
    await waitScontrini(3, 'default: 3 scontrini (A+B+C)');
    assert.equal(
      flat(await page.getByTestId(`totals-totale-${RS}`).innerText()),
      '180,00€',
      'default: totale contabile 100+50+30 = 180,00 €',
    );
    assert.equal(await contabileDataRows().count(), 3, 'default: 3 righe giorno×PDV in Prima Nota Contabile');

    // ── Seleziona 2 PDV (A + B): semantica OR ──
    await trigger.click();
    await page.getByTestId(`option-select-pdv-${POS_A}`).click();
    await page.getByTestId(`option-select-pdv-${POS_B}`).click();
    await page.keyboard.press('Escape');
    assert.equal((await trigger.innerText()).trim(), '2 PDV selezionati', 'trigger mostra il conteggio con 2 selezioni');

    await waitScontrini(2, 'filtro A+B: 2 scontrini');
    assert.equal(
      flat(await page.getByTestId(`totals-totale-${RS}`).innerText()),
      '150,00€',
      'filtro A+B: totale contabile 100+50 = 150,00 €',
    );
    assert.equal(await contabileDataRows().count(), 2, 'filtro A+B: 2 righe in Prima Nota Contabile');
    const contabileText = await page.locator('main').innerText();
    assert.ok(contabileText.includes('Negozio Amm Alfa'), 'filtro A+B: PDV A presente');
    assert.ok(contabileText.includes('Negozio Amm Beta'), 'filtro A+B: PDV B presente');
    assert.ok(!contabileText.includes('Negozio Amm Gamma'), 'filtro A+B: PDV C (non selezionato) escluso');

    // ── Prima Nota IVA con filtro attivo: totali limitati ad A+B ──
    await page.locator('[data-testid^="tab-iva"]:visible').first().click();
    const ivaHeader = page.getByTestId(`rs-iva-header-${RS}`);
    await ivaHeader.waitFor({ timeout: 15000 });
    const iva22Row = page.locator('tr', { hasText: 'IVA 22%' }).first();
    await iva22Row.waitFor({ timeout: 15000 });
    let iva22 = flat(await iva22Row.innerText());
    assert.ok(iva22.includes('IVA22%2'), `filtro A+B: 2 pezzi IVA 22% (${iva22})`);
    assert.ok(iva22.includes('30,00€'), `filtro A+B: imponibile 10+20 = 30,00 € (${iva22})`);
    assert.ok(iva22.includes('6,60€'), `filtro A+B: imposta 2,20+4,40 = 6,60 € (${iva22})`);
    assert.ok(iva22.includes('36,60€'), `filtro A+B: lordo 12,20+24,40 = 36,60 € (${iva22})`);

    // ── Ritorno a "Tutti i PDV" via option-select-pdv-all ──
    await trigger.click();
    await page.getByTestId('option-select-pdv-all').click();
    await page.keyboard.press('Escape');
    assert.equal((await trigger.innerText()).trim(), 'Tutti i PDV', 'voce "tutti" azzera la selezione');

    // IVA: la riga 22% torna a 3 pezzi con i totali completi.
    await page.waitForFunction(
      () => {
        const rows = Array.from(document.querySelectorAll('tr'));
        const r = rows.find((el) => el.textContent?.includes('IVA 22%'));
        return r && r.textContent.replace(/[\s\u00a0]/g, '').includes('73,20€');
      },
      null,
      { timeout: 15000 },
    );
    iva22 = flat(await iva22Row.innerText());
    assert.ok(iva22.includes('IVA22%3'), `tutti i PDV: 3 pezzi IVA 22% (${iva22})`);
    assert.ok(iva22.includes('60,00€'), `tutti i PDV: imponibile 60,00 € (${iva22})`);
    assert.ok(iva22.includes('13,20€'), `tutti i PDV: imposta 13,20 € (${iva22})`);
    assert.ok(iva22.includes('73,20€'), `tutti i PDV: lordo 73,20 € (${iva22})`);

    // Contabile: totali completi ripristinati.
    await page.locator('[data-testid^="tab-contabile"]:visible').first().click();
    await waitScontrini(3, 'tutti i PDV: 3 scontrini ripristinati');
    assert.equal(
      flat(await page.getByTestId(`totals-totale-${RS}`).innerText()),
      '180,00€',
      'tutti i PDV: totale contabile 180,00 € ripristinato',
    );
    assert.equal(await contabileDataRows().count(), 3, 'tutti i PDV: 3 righe in Prima Nota Contabile');
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
