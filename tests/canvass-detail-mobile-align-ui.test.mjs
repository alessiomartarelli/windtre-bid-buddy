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

// Task #497: allineamento mobile delle righe Canvass anche nei dettagli
// espansi per PDV e per Addetto di /vendite-bisuite ("Categorie canvass").
//
// A 375px ogni riga categoria deve mantenere una colonna numerica comune:
// conteggi incolonnati alla stessa estremità e diciture "(N IVA)" allineate
// fra loro, con slot riservato anche sulle righe senza IVA (come nel riquadro
// Canvass globale, tests/canvass-mobile-align-ui.test.mjs). Desktop resta
// invariato: valori sulla stessa riga, testo identico ("1 (1 IVA)").

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const DATA_VENDITA = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-10T10:00:00.000Z`;

const POS = 'POSDET1';
const NEGOZIO = 'Negozio Dettaglio';
const ADDETTO = 'Mario Dettaglio';

// Stessa classificazione realistica di bisuite-iva-pieces-ui:
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
}; // mobile, non IVA → riga con slot IVA riservato ma vuoto
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
}; // energia, nessun pezzo IVA

async function insertSale(pool, orgId, articoli) {
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        nome_addetto, stato, totale, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      orgId,
      Math.floor(Math.random() * 2_000_000_000),
      DATA_VENDITA,
      POS,
      NEGOZIO,
      ADDETTO,
      'FINALIZZATA',
      '35.00',
      JSON.stringify({ articoli }),
    ],
  );
}

const boxOf = (locator) => locator.boundingBox();
const flat = (s) => s.replace(/\s+/g, '');

// Verifica la colonna numerica comune dentro un blocco "Categorie canvass"
// (prefix = pdv-<pos> oppure addetto-<nome>).
async function assertDetailAligned(page, prefix, label) {
  const container = page.getByTestId(`${prefix}-categorie-canvass`);
  await container.waitFor({ state: 'visible', timeout: 15000 });

  // ── Conteggi incolonnati alla stessa estremità (anche fra piste diverse,
  //    che a 375px sono in un'unica colonna) ──
  const countIds = [
    `${prefix}-cat-count-mobile-TIED IVA`,
    `${prefix}-cat-count-mobile-UNTIED`,
    `${prefix}-cat-count-fisso-ADSL/FIBRA/FWA IVA`,
    `${prefix}-cat-count-energia-ENERGIA W3`,
  ];
  const rights = [];
  for (const id of countIds) {
    const box = await boxOf(page.getByTestId(id));
    assert.ok(box, `${label}: conteggio ${id} misurabile`);
    rights.push(box.x + box.width);
  }
  const spread = Math.max(...rights) - Math.min(...rights);
  assert.ok(spread <= 1.5, `${label}: conteggi incolonnati (spread=${spread.toFixed(2)}px)`);

  // ── Diciture "(N IVA)" allineate fra loro al medesimo bordo destro ──
  const ivaTied = await boxOf(page.getByTestId(`${prefix}-cat-iva-mobile-TIED IVA`));
  const ivaFisso = await boxOf(page.getByTestId(`${prefix}-cat-iva-fisso-ADSL/FIBRA/FWA IVA`));
  assert.ok(ivaTied && ivaFisso, `${label}: diciture IVA misurabili`);
  const ivaSpread = Math.abs((ivaTied.x + ivaTied.width) - (ivaFisso.x + ivaFisso.width));
  assert.ok(ivaSpread <= 1.5, `${label}: diciture IVA allineate (spread=${ivaSpread.toFixed(2)}px)`);
  // Le righe senza IVA non espongono la dicitura (solo slot riservato).
  assert.equal(await page.getByTestId(`${prefix}-cat-iva-mobile-UNTIED`).count(), 0, `${label}: UNTIED senza dicitura IVA`);
  assert.equal(await page.getByTestId(`${prefix}-cat-iva-energia-ENERGIA W3`).count(), 0, `${label}: ENERGIA W3 senza dicitura IVA`);

  // ── Leggibilità e nessuna sovrapposizione/overflow ──
  const countFont = await page.getByTestId(`${prefix}-cat-count-mobile-TIED IVA`)
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  assert.ok(countFont >= 14, `${label}: conteggi leggibili (font-size=${countFont}px >= 14)`);
  for (const id of ['mobile-TIED IVA', 'mobile-UNTIED', 'fisso-ADSL/FIBRA/FWA IVA', 'energia-ENERGIA W3']) {
    const geo = await page.getByTestId(`${prefix}-cat-row-${id}`).evaluate((row) => {
      const nameEl = row.children[0].getBoundingClientRect();
      const values = row.children[1].getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const horizontalOverlap = nameEl.right > values.left + 1 && nameEl.top < values.bottom - 1 && values.top < nameEl.bottom - 1;
      const overflow = Array.from(row.querySelectorAll('span')).some((child) => {
        const r = child.getBoundingClientRect();
        return r.left < rowRect.left - 1 || r.right > rowRect.right + 1;
      });
      return { horizontalOverlap, overflow };
    });
    assert.equal(geo.horizontalOverlap, false, `${label} ${id}: etichetta e valori non si sovrappongono`);
    assert.equal(geo.overflow, false, `${label} ${id}: nessun contenuto fuori dalla riga`);
  }

  // ── Testo invariato ("1 (1 IVA)" dopo il conteggio, come prima) ──
  const text = flat(await container.innerText());
  assert.ok(text.includes('TIEDIVA1(1IVA)'), `${label}: TIED IVA 1 (1 IVA): ${text}`);
  assert.ok(text.includes('UNTIED11') && !text.includes('UNTIED11('), `${label}: UNTIED senza marcatore IVA: ${text}`);
}

test('Vendite BiSuite mobile 375px: dettagli PDV e Addetto con colonna numerica comune nelle Categorie canvass', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cnv_det_align', fullName: 'Canvass Detail Align UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    // Mobile: 12 pezzi (11 UNTIED a due cifre + 1 TIED IVA), fisso: 1 pezzo
    // IVA, energia: 2 pezzi senza IVA — stesso PDV e stesso addetto, così i
    // dettagli espansi mostrano tre piste con e senza dicitura IVA.
    await insertSale(pool, session.orgId, [artTiedIva, ...Array(11).fill(artUntied)]);
    await insertSale(pool, session.orgId, [artFissoIva]);
    await insertSale(pool, session.orgId, [artEnergiaConsumer, artEnergiaConsumer]);

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/vendite-bisuite`, { waitUntil: 'networkidle' });

    // ── Dettaglio per PDV ──
    await page.getByTestId('button-view-vendite').waitFor({ timeout: 20000 });
    await page.locator(`button:has-text("${NEGOZIO}")`).first().click();
    await assertDetailAligned(page, `pdv-${POS}`, 'PDV');

    // ── Dettaglio per Addetto ──
    await page.getByTestId('button-view-addetti').click();
    await page.locator(`button:has-text("${ADDETTO}")`).first().click();
    await assertDetailAligned(page, `addetto-${ADDETTO}`, 'Addetto');

    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(pageOverflow <= 1, `nessun overflow orizzontale di pagina (${pageOverflow}px)`);

    // ── Desktop: resa invariata (valori sulla stessa riga, dopo l'etichetta) ──
    await page.setViewportSize({ width: 1280, height: 900 });
    const row = page.getByTestId(`addetto-${ADDETTO}-cat-row-mobile-TIED IVA`);
    await row.waitFor({ state: 'visible', timeout: 15000 });
    const desktop = await row.evaluate((el) => {
      const name = el.children[0].getBoundingClientRect();
      const values = el.children[1].getBoundingClientRect();
      const center = name.top + name.height / 2;
      return { sameLine: center > values.top && center < values.bottom };
    });
    assert.equal(desktop.sameLine, true, 'desktop: etichetta e valori sulla stessa riga');
    // Su desktop lo slot riservato collassa: il conteggio UNTIED termina al
    // bordo destro della riga come prima (nessuna colonna IVA fantasma).
    const untiedGap = await page.getByTestId(`addetto-${ADDETTO}-cat-row-mobile-UNTIED`).evaluate((el) => {
      const rowRect = el.getBoundingClientRect();
      const count = el.querySelector('[data-testid$="cat-count-mobile-UNTIED"]').getBoundingClientRect();
      return rowRect.right - count.right;
    });
    assert.ok(untiedGap <= 2, `desktop: nessuno slot IVA fantasma dopo il conteggio (gap=${untiedGap.toFixed(2)}px)`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
