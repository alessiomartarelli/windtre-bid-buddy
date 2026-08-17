import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BASE,
  uniq,
  signup,
  newPool,
  launchBrowser,
  newAuthedContext,
  cleanupOrg,
} from './helpers/uiTest.mjs';

// Mobile UI (375×812 + touch) per il task #376: Vendite BiSuite e pagine
// restanti (Controllo di Gestione, Gestione DTS, Configurazione Gara).
// Verifica: nessun overflow orizzontale, toolbar che wrappa, tabelle in
// ScrollableTable con header sticky.

async function assertNoHorizontalOverflow(page, label) {
  const o = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  assert.ok(
    o.scrollWidth <= o.innerWidth + 1,
    `${label}: horizontal overflow on mobile (scrollWidth=${o.scrollWidth}, innerWidth=${o.innerWidth})`,
  );
}

// Come in mobile-cj-admin-ui.test.mjs: tabella dentro ScrollableTable con
// header sticky e contenitore verticale delimitato.
async function assertStickyScrollableTable(page, containerSelector, label) {
  const info = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return { error: 'container not found' };
    const vp = root.querySelector('[data-testid="scrollable-table-viewport"]');
    const th = vp?.querySelector('thead th');
    const vscroll = vp?.querySelector('.overflow-y-auto');
    if (!vp || !th || !vscroll) return { error: `missing pieces vp=${!!vp} th=${!!th} vscroll=${!!vscroll}` };
    const before = th.getBoundingClientRect().top;
    vscroll.scrollTop = 200;
    const after = th.getBoundingClientRect().top;
    return {
      hScrollable: vp.scrollWidth > vp.clientWidth + 4,
      vScrollable: vscroll.scrollHeight > vscroll.clientHeight + 4,
      sticky: getComputedStyle(th).position === 'sticky',
      headerStays: Math.abs(after - before) <= 2,
      scrolled: vscroll.scrollTop > 0,
    };
  }, containerSelector);
  assert.ok(!info.error, `${label}: ${info.error}`);
  assert.ok(info.hScrollable, `${label}: la tabella deve scorrere orizzontalmente nel viewport ScrollableTable`);
  assert.ok(info.vScrollable && info.scrolled, `${label}: il contenitore verticale deve scorrere (righe sufficienti)`);
  assert.ok(info.sticky, `${label}: header th deve essere sticky`);
  assert.ok(info.headerStays, `${label}: header deve restare visibile durante lo scroll verticale`);
}

async function seedBisuiteSales(pool, orgId, {
  count = 30,
  addetto = 'Mario Rossi',
  startId = 100000,
  codicePos = 'POS001',
  nomeNegozio = 'Negozio Mobile 376',
  ragioneSociale = null,
} = {}) {
  for (let i = 0; i < count; i++) {
    await pool.query(
      `INSERT INTO bisuite_sales
         (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
          nome_addetto, nome_cliente, totale, stato, raw_data, ragione_sociale)
       VALUES ($1, $2, now() - ($3 || ' minutes')::interval, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
      [
        orgId,
        startId + i,
        String(i),
        codicePos,
        nomeNegozio,
        addetto,
        `Cliente ${i}`,
        '25.00',
        'FINALIZZATA',
        // codiceEsterno = ID VENDITA usato dal report DTS per il match
        // lead ↔ vendita (dtsSaleCodiceEsterno legge rawData.codiceEsterno).
        // Articoli classificabili (shared/bisuiteClassification.ts,
        // classifySaleArticles): uno canvass + uno prodotti per vendita,
        // così report.perCategoriaCanvass e report.perProdotto hanno righe
        // (task #380) e le tabelle "per categoria canvass" / "per prodotto"
        // di Gestione DTS non restano in stato vuoto.
        JSON.stringify({
          codiceEsterno: 100000 + i,
          articoli: [
            {
              categoria: { nome: ['UNTIED', 'ADSL/FIBRA/FWA CF', 'RIVINCOLO'][i % 3] },
              tipologia: { nome: 'OFFERTA' },
              descrizione: `Offerta canvass ${i}`,
              dettaglio: { prezzo: '10.00' },
            },
            {
              categoria: { nome: ['TELEFONIA', 'ACCESSORI', 'SIM'][i % 3] },
              tipologia: { nome: 'PRODOTTO' },
              descrizione: `Prodotto ${i}`,
              dettaglio: { prezzo: '15.00' },
            },
          ],
        }),
        ragioneSociale,
      ],
    );
  }
}

// Lead DTS minimi (mese corrente, Europe/Rome) agganciati alle vendite
// seminate da seedBisuiteSales via id_vendita = codiceEsterno.
async function seedDtsLeads(pool, orgId, { count = 8 } = {}) {
  for (let i = 0; i < count; i++) {
    await pool.query(
      `INSERT INTO dts_leads
         (organization_id, lead_key, consulente, campagna, nominativo, data, id_vendita, file_name)
       VALUES ($1, $2, $3, 'CAMPAGNA MOBILE 378', $4,
               (now() at time zone 'Europe/Rome')::date, $5, 'seed-mobile-378.xlsx')`,
      [orgId, `mob378-${i}`, `Consulente Mobile ${i % 3}`, `Nominativo ${i}`, 100000 + i],
    );
  }
}

// Upload DRMS salvato con righe già normalizzate/classificate (DrmsRow):
// 3 PDV × 4 capitoli × 2 competenze, così si popolano sia la matrice
// PV×Capitoli sia la tabella andamento per competenza (>1 competenza).
async function seedDrmsUpload(pool, orgId) {
  const capitoli = ['MOBILE', 'FISSO', 'ENERGIA', 'CB'];
  const rows = [];
  let seq = 0;
  for (const pv of ['PV001', 'PV002', 'PV003']) {
    for (const cap of capitoli) {
      for (const comp of ['2026-06', '2026-07']) {
        rows.push({
          CAPITOLO: cap,
          SEQ_ID: `mob378-${seq++}`,
          CODICE_NEGOZIO_COSY: pv,
          CODICE_CONTRATTO: `C${seq}`,
          COMPETENZA: comp,
          TIPO_FONIA: '',
          TIPO_ATTIVAZIONE: '',
          REGOLA_DI_CALCOLO: '',
          DESCRIZIONE_ITEM: `Item ${seq}`,
          DESCRIZIONE_PIANO_TARIFFARIO: '',
          DESCRIZIONE_EVENTO: '',
          NATURA: '',
          MNP: '',
          SEGMENTO_CLIENT: '',
          TIPO_ACCESSO: '',
          TIPO_LINEA: '',
          FLAG_CONVERGENZA: '',
          FLAG_SOGLIA_MOBILE: '',
          FLAG_SOGLIA_FISSA: '',
          IMPORTO_NUM: 10 + seq,
        });
      }
    }
  }
  const r = await pool.query(
    `INSERT INTO drms_uploads
       (organization_id, month, year, file_name, period, totale_importo, righe_count, rows)
     VALUES ($1, 7, 2026, 'seed-mobile-378.xlsx', 'JUL-26', '100.00', $2, $3::jsonb)
     RETURNING id`,
    [orgId, rows.length, JSON.stringify(rows)],
  );
  return r.rows[0].id;
}

// PDF minimale ma valido (testo Helvetica) che parseGaraPdf riconosce come
// gara fonia: "ALLEGATO" + righe PDV "9xxxxxxxxx 8xxxxxxxxx <clusterM> <clusterF>".
function buildGaraPdf({ pdvCount = 8 } = {}) {
  const lines = [
    'INCENTIVAZIONE LUGLIO 2026',
    'Spett.le Test RS Mobile Cod. Dealer: 8000000001',
    'ALLEGATO A ELENCO PUNTI VENDITA',
  ];
  for (let i = 0; i < pdvCount; i++) {
    lines.push(`${9000000001 + i} 8000000001 ${(i % 3) + 1} ${((i + 1) % 3) + 1}`);
  }
  let content = 'BT /F1 10 Tf 30 760 Td\n';
  for (const l of lines) content += `(${l}) Tj 0 -14 Td\n`;
  content += 'ET';
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// La tabella ancorata da anchorSelector deve vivere in un wrapper
// overflow-x-auto contenuto nel viewport: il wrapper non sborda dalla
// pagina e, se la tabella è più larga, lo scroll orizzontale avviene
// DENTRO il wrapper (scrollLeft si muove davvero).
async function assertTableContainedInWrapper(page, anchorSelector, label) {
  const info = await page.evaluate((sel) => {
    const anchor = document.querySelector(sel);
    if (!anchor) return { error: `anchor not found: ${sel}` };
    let el = anchor.closest('table');
    const table = el;
    if (!table) return { error: 'no table ancestor' };
    let wrapper = table.parentElement;
    while (wrapper && !['auto', 'scroll'].includes(getComputedStyle(wrapper).overflowX)) {
      wrapper = wrapper.parentElement;
    }
    if (!wrapper) return { error: 'no overflow-x wrapper ancestor' };
    const rect = wrapper.getBoundingClientRect();
    const overflowing = table.scrollWidth > wrapper.clientWidth + 4;
    let scrolled = null;
    if (overflowing) {
      wrapper.scrollLeft = 60;
      scrolled = wrapper.scrollLeft > 0;
      wrapper.scrollLeft = 0;
    }
    return {
      wrapperRight: rect.right,
      wrapperLeft: rect.left,
      innerWidth: window.innerWidth,
      rows: table.querySelectorAll('tbody tr').length,
      overflowing,
      scrolled,
    };
  }, anchorSelector);
  assert.ok(!info.error, `${label}: ${info.error}`);
  assert.ok(info.rows > 0, `${label}: la tabella deve avere righe con dati reali`);
  assert.ok(
    info.wrapperRight <= info.innerWidth + 1 && info.wrapperLeft >= -1,
    `${label}: il wrapper overflow-x-auto sborda dal viewport (left=${info.wrapperLeft}, right=${info.wrapperRight}, innerWidth=${info.innerWidth})`,
  );
  if (info.overflowing) {
    assert.ok(info.scrolled, `${label}: la tabella più larga del wrapper deve scorrere DENTRO il wrapper`);
  }
}

test('mobile: Vendite BiSuite e Controllo di Gestione usabili su smartphone', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'mob_vb', fullName: 'Mobile VB', organizationName: uniq('MobVB') });
  const browser = await launchBrowser();
  try {
    await seedBisuiteSales(pool, session.orgId, { count: 30 });
    // Seed extra per la Tabella PDV × Pista (Pezzi): 2 RS, più PDV, così le
    // righe espanse rendono il contenitore verticalmente scrollabile.
    for (let p = 0; p < 6; p++) {
      await seedBisuiteSales(pool, session.orgId, {
        count: 3,
        startId: 200000 + p * 10,
        codicePos: `POSP${p}`,
        nomeNegozio: `Negozio Pezzi ${p}`,
        ragioneSociale: p < 3 ? 'Alfa S.r.l.' : 'Beta S.p.A.',
      });
    }

    const context = await newAuthedContext(browser, session, { mobile: true });
    const page = await context.newPage();

    // ── Vendite BiSuite: lista vendite in ScrollableTable, nessun overflow ──
    await page.goto(`${BASE}/vendite-bisuite`, { waitUntil: 'networkidle' });
    await page.getByTestId('button-view-vendite').waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForSelector('[data-testid="scrollable-table-viewport"] table', { timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'VenditeBiSuite');
    await assertStickyScrollableTable(page, '[data-testid="card-lista-vendite"]', 'VenditeBiSuite lista vendite');

    // ── Tabella PDV × Pista (Pezzi): aggregazione RS→PDV, totali e sticky ──
    const pezziCard = page.locator('[data-testid="card-tabella-pdv-pista-pezzi"]');
    await pezziCard.waitFor({ state: 'visible', timeout: 20000 });
    // 2 RS con nome + "Senza RS" del seed base
    await page.locator('[data-testid^="row-pezzi-rs-"]').first().waitFor({ timeout: 20000 });
    const rsCount = await page.locator('[data-testid^="row-pezzi-rs-"]').count();
    assert.ok(rsCount >= 3, `attese >=3 righe RS nella tabella pezzi, trovate ${rsCount}`);
    // Totale mobile: UNTIED ogni i%3==0 → 10 (base) + 6 PDV × 1 = 16
    const totMobile = await page.getByTestId('cell-pezzi-tot-mobile').innerText();
    assert.equal(totMobile.trim(), '16', 'totale colonna mobile della tabella pezzi');
    // Totale fisso: ADSL/FIBRA/FWA CF ogni i%3==1 → 10 + 6 = 16
    const totFisso = await page.getByTestId('cell-pezzi-tot-fisso').innerText();
    assert.equal(totFisso.trim(), '16', 'totale colonna fisso della tabella pezzi');
    // Espandi tutto: le righe PDV compaiono e la tabella scorre con header sticky
    await page.getByTestId('btn-pezzi-expand-all').click();
    await page.locator('[data-testid^="row-pezzi-pdv-"]').first().waitFor({ timeout: 20000 });
    const pdvRows = await page.locator('[data-testid^="row-pezzi-pdv-"]').count();
    assert.ok(pdvRows >= 7, `attese >=7 righe PDV espanse, trovate ${pdvRows}`);
    await assertStickyScrollableTable(page, '[data-testid="card-tabella-pdv-pista-pezzi"]', 'Tabella PDV × Pista (Pezzi)');

    // ── Vista per addetto: dettaglio vendite addetto sticky + scrollabile ──
    await page.getByTestId('button-view-addetti').click();
    // Il bottone "Vedi tutte le vendite" vive nell'AccordionContent: espandi prima.
    const trigger = page.locator('button:has-text("Mario Rossi")').first();
    await trigger.waitFor({ state: 'visible', timeout: 20000 });
    await trigger.click();
    const viewAddetto = page.locator('[data-testid^="button-view-addetto-"]').first();
    await viewAddetto.scrollIntoViewIfNeeded();
    await viewAddetto.click();
    await page.getByTestId('button-back-addetti').waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'VenditeBiSuite/addetto');
    await assertStickyScrollableTable(page, 'body', 'VenditeBiSuite dettaglio addetto');

    // ── Controllo di Gestione: nessun overflow ──
    await page.goto(`${BASE}/controllo-gestione`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main, h1, h2', { timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'ControlloGestione');

    // ── Gestione DTS: nessun overflow ──
    await page.goto(`${BASE}/gestione-dts`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main, h1, h2', { timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'GestioneDts');

    // ── Configurazione Gara: nessun overflow ──
    await page.goto(`${BASE}/configurazione-gara`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main, h1, h2', { timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'ConfigurazioneGara');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// Task #378: le tabelle di Gestione DTS, DRMS Commissioning e Configurazione
// Gara vengono verificate a 375px CON dati reali (seed DB + import PDF), non
// più in stato vuoto: niente overflow di pagina e scroll orizzontale
// contenuto nel wrapper overflow-x-auto di ciascuna tabella.
test('mobile: tabelle DTS, DRMS e Configurazione Gara popolate su smartphone', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'mob_dg', fullName: 'Mobile DG', organizationName: uniq('MobDG') });
  const browser = await launchBrowser();
  try {
    await seedBisuiteSales(pool, session.orgId, { count: 12 });
    await seedDtsLeads(pool, session.orgId, { count: 8 });
    const drmsId = await seedDrmsUpload(pool, session.orgId);

    const context = await newAuthedContext(browser, session, { mobile: true });
    const page = await context.newPage();

    // ── Gestione DTS: report per consulente e per negozio popolati ──
    await page.goto(`${BASE}/gestione-dts`, { waitUntil: 'networkidle' });
    await page.locator('[data-testid^="row-dts-consulente-"]').first().waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('[data-testid^="row-dts-negozio-"]').first().waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'GestioneDts (popolata)');
    await assertTableContainedInWrapper(page, '[data-testid^="row-dts-consulente-"]', 'DTS per consulente');
    await assertTableContainedInWrapper(page, '[data-testid^="row-dts-negozio-"]', 'DTS per negozio');

    // ── Per categoria canvass e per prodotto: popolate con dati reali (task #380) ──
    await page.locator('[data-testid^="row-dts-cat-"]').first().waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('[data-testid^="row-dts-prod-"]').first().waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'GestioneDts (cat/prod popolate)');
    await assertTableContainedInWrapper(page, '[data-testid^="row-dts-cat-"]', 'DTS per categoria canvass');
    await assertTableContainedInWrapper(page, '[data-testid^="row-dts-prod-"]', 'DTS per prodotto');

    // ── DRMS Commissioning: carica l'upload salvato, panoramica + matrice ──
    await page.goto(`${BASE}/drms-commissioning`, { waitUntil: 'networkidle' });
    const loadBtn = page.getByTestId(`button-load-drms-${drmsId}`);
    await loadBtn.waitFor({ state: 'visible', timeout: 20000 });
    await loadBtn.click();
    // Panoramica: tabella andamento per competenza (2 competenze seminate).
    await page.locator('[data-testid^="row-competenza-"]').first().waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'DRMS panoramica');
    await assertTableContainedInWrapper(page, '[data-testid^="row-competenza-"]', 'DRMS andamento competenza');
    // Matrice PV × Capitoli.
    const matrixTab = page.getByTestId('tab-drms-matrix');
    await matrixTab.scrollIntoViewIfNeeded();
    await matrixTab.click();
    await page.getByTestId('row-matrix-PV001').waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'DRMS matrice');
    await assertTableContainedInWrapper(page, '[data-testid="row-matrix-PV001"]', 'DRMS matrice PV×Capitoli');

    // ── Configurazione Gara: import PDF ⇒ tabella PDV del PDF popolata ──
    const pdfPath = join(tmpdir(), `gara-mobile-378-${Date.now()}.pdf`);
    writeFileSync(pdfPath, buildGaraPdf({ pdvCount: 8 }));
    try {
      await page.goto(`${BASE}/configurazione-gara`, { waitUntil: 'networkidle' });
      const importBtn = page.getByTestId('button-import');
      await importBtn.waitFor({ state: 'visible', timeout: 20000 });
      await importBtn.click();
      const pdfBtn = page.getByTestId('button-import-pdf-gara');
      await pdfBtn.waitFor({ state: 'visible', timeout: 20000 });
      await pdfBtn.click();
      await page.setInputFiles('[data-testid="input-pdf-upload"]', pdfPath);
      // I PDV seminati nel PDF non sono in struttura canonica ⇒ badge "missing".
      await page.getByTestId('badge-pdv-missing-9000000001').waitFor({ state: 'visible', timeout: 30000 });
      await assertNoHorizontalOverflow(page, 'ConfigurazioneGara (import PDF)');
      await assertTableContainedInWrapper(page, '[data-testid="badge-pdv-missing-9000000001"]', 'Gara tabella PDV da PDF');
    } finally {
      rmSync(pdfPath, { force: true });
    }

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
