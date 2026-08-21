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

// Task #494: allineamento mobile delle righe Canvass in /vendite-bisuite.
//
// A 375px ogni riga della sezione Canvass deve mantenere una colonna numerica
// comune: badge conteggio incolonnati alla stessa estremità destra e diciture
// "di cui N IVA" allineate fra loro (slot riservato anche sulle righe senza
// IVA), senza rimpicciolire il testo e senza sovrapposizioni tra etichetta e
// valori. Desktop resta su riga singola.

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const DATA_VENDITA = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-10T10:00:00.000Z`;

// Articoli realistici (stessa classificazione di bisuite-iva-pieces-ui):
const artTiedIva = {
  categoria: { nome: 'TIED IVA' },
  tipologia: { nome: 'SIM' },
  descrizione: 'WINDTRE BUSINESS TIED',
  dettaglio: { prezzo: '10.00' },
}; // mobile, pezzo IVA
const artUntied = {
  categoria: { nome: 'UNTIED' },
  tipologia: { nome: 'SIM' },
  descrizione: 'WINDTRE UNTIED CONSUMER',
  dettaglio: { prezzo: '5.00' },
}; // mobile, non IVA
const artFissoIva = {
  categoria: { nome: 'ADSL/FIBRA/FWA IVA' },
  tipologia: { nome: 'FISSO' },
  descrizione: 'SUPER FIBRA PARTITA IVA',
  dettaglio: { prezzo: '20.00' },
}; // fisso, pezzo IVA
const artEnergiaConsumer = {
  categoria: { nome: 'ENERGIA W3' },
  tipologia: { nome: 'ENERGIA' },
  descrizione: 'OFFERTA LUCE CASA',
  dettaglio: { prezzo: '0.00' },
}; // energia, NESSUN pezzo IVA → riga senza dicitura IVA

async function insertSale(pool, orgId, articoli) {
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        stato, totale, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      orgId,
      Math.floor(Math.random() * 2_000_000_000),
      DATA_VENDITA,
      'POSALN1',
      'Negozio Align',
      'FINALIZZATA',
      '35.00',
      JSON.stringify({ articoli }),
    ],
  );
}

const boxOf = (locator) => locator.boundingBox();

test('Vendite BiSuite mobile 375px: righe Canvass con colonna numerica comune (badge e IVA incolonnati)', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cnv_align', fullName: 'Canvass Align UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    // Mobile: 12 pezzi (conteggio a più cifre) di cui 1 IVA; fisso: 1 pezzo
    // IVA; energia: 2 pezzi senza IVA (riga che NON mostra la dicitura).
    await insertSale(pool, session.orgId, [artTiedIva, ...Array(11).fill(artUntied)]);
    await insertSale(pool, session.orgId, [artFissoIva]);
    await insertSale(pool, session.orgId, [artEnergiaConsumer, artEnergiaConsumer]);

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/vendite-bisuite`, { waitUntil: 'networkidle' });

    // Su mobile la sezione Canvass si raggiunge dalla barra categorie a icone.
    const navCanvass = page.getByTestId('sales-category-mobile-canvass');
    await navCanvass.waitFor({ state: 'visible', timeout: 30000 });
    await navCanvass.click();
    await page.getByTestId('sales-category-panel-canvass').waitFor({ state: 'visible', timeout: 15000 });

    const pistas = ['mobile', 'fisso', 'energia'];
    const rows = {};
    for (const p of pistas) {
      rows[p] = page.getByTestId(`row-summary-pista-${p}`);
      await rows[p].waitFor({ state: 'visible', timeout: 15000 });
    }

    // ── Badge conteggio incolonnati alla stessa estremità destra ──
    const badgeRight = {};
    for (const p of pistas) {
      const badge = rows[p].locator(':scope > div').nth(1).locator('div').last();
      const box = await boxOf(badge);
      assert.ok(box, `badge ${p} misurabile`);
      badgeRight[p] = box.x + box.width;
    }
    const rights = Object.values(badgeRight);
    const spread = Math.max(...rights) - Math.min(...rights);
    assert.ok(spread <= 1.5, `badge incolonnati a destra (spread=${spread.toFixed(2)}px, ${JSON.stringify(badgeRight)})`);

    // ── Diciture "di cui N IVA" allineate fra loro (colonna comune) ──
    const ivaMobile = await boxOf(page.getByTestId('text-iva-mobile'));
    const ivaFisso = await boxOf(page.getByTestId('text-iva-fisso'));
    assert.ok(ivaMobile && ivaFisso, 'diciture IVA mobile e fisso misurabili');
    const ivaSpread = Math.abs((ivaMobile.x + ivaMobile.width) - (ivaFisso.x + ivaFisso.width));
    assert.ok(ivaSpread <= 1.5, `diciture IVA allineate al medesimo bordo destro (spread=${ivaSpread.toFixed(2)}px)`);
    // La riga energia non mostra IVA ma il suo badge resta nella stessa colonna
    // (già coperto dallo spread dei badge sopra) e non espone la dicitura.
    assert.equal(await page.getByTestId('text-iva-energia').count(), 0, 'energia senza pezzi IVA: nessuna dicitura');

    // ── Leggibilità: nessun testo rimpicciolito sotto i minimi precedenti ──
    const labelFont = await rows.mobile.locator(':scope > div').first().locator('span').first()
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    assert.ok(labelFont >= 14, `etichetta pista leggibile (font-size=${labelFont}px >= 14)`);
    const ivaFont = await page.getByTestId('text-iva-mobile')
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    assert.ok(ivaFont >= 12, `dicitura IVA leggibile (font-size=${ivaFont}px >= 12)`);

    // ── Nessuna sovrapposizione etichetta/valori e nessun overflow ──
    for (const p of pistas) {
      const geo = await rows[p].evaluate((row) => {
        const label = row.children[0].getBoundingClientRect();
        const values = row.children[1].getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const horizontalOverlap = label.right > values.left + 1 && label.top < values.bottom - 1 && values.top < label.bottom - 1;
        const overflow = Array.from(row.querySelectorAll('span, div')).some((child) => {
          const r = child.getBoundingClientRect();
          return r.left < rowRect.left - 1 || r.right > rowRect.right + 1;
        });
        return { horizontalOverlap, overflow };
      });
      assert.equal(geo.horizontalOverlap, false, `${p}: etichetta e valori non si sovrappongono`);
      assert.equal(geo.overflow, false, `${p}: nessun contenuto fuori dalla riga`);
    }
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(pageOverflow <= 1, `nessun overflow orizzontale di pagina (${pageOverflow}px)`);

    // ── Desktop: riga singola, resa invariata ──
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByTestId('row-summary-pista-mobile').waitFor({ state: 'visible', timeout: 15000 });
    const desktop = await page.getByTestId('row-summary-pista-mobile').evaluate((row) => {
      const label = row.children[0].getBoundingClientRect();
      const values = row.children[1].getBoundingClientRect();
      const labelCenter = label.top + label.height / 2;
      return { sameLine: labelCenter > values.top && labelCenter < values.bottom };
    });
    assert.equal(desktop.sameLine, true, 'desktop: etichetta e valori sulla stessa riga');
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
