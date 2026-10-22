import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { launchBrowser } from './helpers/uiTest.mjs';

// Test suite Customer Journey — export PDF/Excel (Task #190).
//
// Logica PURA di costruzione righe/colonne degli export, estratta da
// `client/src/lib/customerJourneyExport.ts` in `shared/customerJourneyExport.ts`
// (import relativi, niente runtime jsPDF/xlsx/react) così è caricabile via
// loader `tsx` senza dev server né DB. Copre i target del task: intestazioni,
// mapping campi, valori driver/stato, filterLabel, nomi file.
//
// Le tabelle di dettaglio (Driver/Contratti) e di elenco (PDF/Excel) hanno
// shape leggermente diverse fra PDF ed Excel (col 0 emoji vs vuota, colonna
// Telefono e "Si"/"Sì" solo in alcune varianti): i test bloccano queste
// differenze volute così che un cambio accidentale alle colonne/dati non rompa
// silenziosamente gli export usati dagli operatori.

const {
  CJ_DRIVER_EMOJI,
  LIST_FIXED_COLS,
  fmtDate,
  journeyTitle,
  safeFileName,
  driverLabel,
  itemDescription,
  itemStateLabel,
  rataCanone,
  activeDriverCount,
  cjAppliedFilterMetadata,
  detailMeta,
  driverTableHead,
  driverTableBody,
  contractsHead,
  contractsBody,
  detailExcelHeaderRows,
  detailFileBase,
  listSubtitle,
  listPdfHead,
  listPdfBody,
  listExcelHeaderRows,
  listExcelHead,
  listExcelBody,
} = await import('../shared/customerJourneyExport.ts');

const { CJ_DRIVER_ORDER, CJ_NO_DESTINATION_FILTER_VALUE } = await import('../shared/customerJourney.ts');
const root = fileURLToPath(new URL('../', import.meta.url));
const fileTestOutput = path.join(root, 'generated-artifacts/cj-list-filter-files');

// Helper: scheda (journey) con default sensati.
function journey(over = {}) {
  return {
    customerType: 'privato',
    customerKey: 'RSSMRA80A01H501U',
    nome: 'Mario',
    cognome: 'Rossi',
    nominativo: 'Mario Rossi',
    ragioneSociale: null,
    telefono: '3331234567',
    codiceCliente: 'C001',
    openedAt: '2026-07-01T00:00:00.000Z',
    status: 'aperta',
    ...over,
  };
}

// Helper: scheda con riepilogo driver (per gli export elenco).
function listJourney(over = {}) {
  return { ...journey(), drivers: [], ...over };
}

// Helper: item/contratto con default sensati.
function item(over = {}) {
  return {
    driver: 'mobile',
    descrizione: 'Offerta Mobile',
    tipologia: null,
    categoria: null,
    codiceContratto: 'CT100',
    addetto: 'Anna',
    pdvOrigine: 'PDV Roma',
    pdvDestinazione: 'PDV Milano',
    imei: '123456789012345',
    rata: null,
    canone: null,
    dataInserimento: '2026-07-02T00:00:00.000Z',
    dataAttivazione: '2026-07-03T00:00:00.000Z',
    state: 'attivato',
    gettoneConfirmed: false,
    ...over,
  };
}

const drivers = (over = {}) =>
  CJ_DRIVER_ORDER.map((d) => ({ driver: d, activated: false, count: 0, ...(over[d] || {}) }));

// ===========================================================================
// fmtDate — data localizzata it-IT, "—" su null/invalido.
// ===========================================================================
test('fmtDate: it-IT, fallback "—" su null/invalido', () => {
  assert.equal(fmtDate(null), '—');
  assert.equal(fmtDate(undefined), '—');
  assert.equal(fmtDate('non-una-data'), '—');
  assert.equal(fmtDate('2026-07-01T00:00:00.000Z'), new Date('2026-07-01T00:00:00.000Z').toLocaleDateString('it-IT'));
});

// ===========================================================================
// journeyTitle — azienda: ragione sociale (fallback nominativo → key);
// privato: Nome+Cognome (fallback nominativo → key).
// ===========================================================================
test('journeyTitle: azienda usa ragione sociale con fallback', () => {
  assert.equal(journeyTitle(journey({ customerType: 'azienda', ragioneSociale: 'Acme SRL' })), 'Acme SRL');
  assert.equal(journeyTitle(journey({ customerType: 'azienda', ragioneSociale: null, nominativo: 'ACME', customerKey: 'PIVA1' })), 'ACME');
  assert.equal(journeyTitle(journey({ customerType: 'azienda', ragioneSociale: null, nominativo: null, customerKey: 'PIVA1' })), 'PIVA1');
});

test('journeyTitle: privato usa Nome+Cognome con fallback', () => {
  assert.equal(journeyTitle(journey({ nome: 'Mario', cognome: 'Rossi' })), 'Mario Rossi');
  assert.equal(journeyTitle(journey({ nome: 'Mario', cognome: null })), 'Mario');
  assert.equal(journeyTitle(journey({ nome: null, cognome: null, nominativo: 'Tizio', customerKey: 'CF1' })), 'Tizio');
  assert.equal(journeyTitle(journey({ nome: null, cognome: null, nominativo: null, customerKey: 'CF1' })), 'CF1');
});

// ===========================================================================
// safeFileName / detailFileBase — nome file safe.
// ===========================================================================
test('safeFileName: sanifica e collassa, fallback "journey"', () => {
  assert.equal(safeFileName('Mario Rossi'), 'Mario_Rossi');
  assert.equal(safeFileName('Acme S.R.L. / Roma'), 'Acme_S.R.L._Roma');
  assert.equal(safeFileName('***'), 'journey');
  assert.equal(safeFileName('a-b_c.d'), 'a-b_c.d');
});

test('detailFileBase: prefisso customer_journey_ + titolo safe', () => {
  assert.equal(detailFileBase(journey({ nome: 'Mario', cognome: 'Rossi' })), 'customer_journey_Mario_Rossi');
});

// ===========================================================================
// driverLabel / itemStateLabel / itemDescription / rataCanone.
// ===========================================================================
test('driverLabel: etichetta nota, fallback al grezzo', () => {
  assert.equal(driverLabel('mobile'), 'Mobile');
  assert.equal(driverLabel('telefono'), 'Smartphone');
  assert.equal(driverLabel('protetti'), 'Windtre Protetti');
  assert.equal(driverLabel('ignoto'), 'ignoto');
});

test('itemStateLabel: etichetta nota, fallback al grezzo', () => {
  assert.equal(itemStateLabel('attivato'), 'Attivato');
  assert.equal(itemStateLabel('in_lavorazione'), 'In lavorazione');
  assert.equal(itemStateLabel('ko'), 'KO');
  assert.equal(itemStateLabel('boh'), 'boh');
});

test('itemDescription: descrizione → tipologia → categoria → "—"', () => {
  assert.equal(itemDescription(item({ descrizione: 'Desc', tipologia: 'Tip', categoria: 'Cat' })), 'Desc');
  assert.equal(itemDescription(item({ descrizione: null, tipologia: 'Tip', categoria: 'Cat' })), 'Tip');
  assert.equal(itemDescription(item({ descrizione: null, tipologia: null, categoria: 'Cat' })), 'Cat');
  assert.equal(itemDescription(item({ descrizione: null, tipologia: null, categoria: null })), '—');
});

test('rataCanone: rata prevale, canone solo se driver != telefono', () => {
  assert.equal(rataCanone(item({ rata: '12,50' })), '€ 12,50');
  assert.equal(rataCanone(item({ rata: null, canone: '30', driver: 'fisso' })), '€ 30');
  // dispositivo telefonia: il canone NON va mostrato come rata/canone
  assert.equal(rataCanone(item({ rata: null, canone: '30', driver: 'telefono' })), '—');
  assert.equal(rataCanone(item({ rata: null, canone: null })), '—');
});

// ===========================================================================
// activeDriverCount — conta i driver attivati della scheda.
// ===========================================================================
test('activeDriverCount: conta solo i driver attivati', () => {
  const d = drivers({ mobile: { activated: true }, energia: { activated: true } });
  assert.equal(activeDriverCount(listJourney({ drivers: d })), 2);
  assert.equal(activeDriverCount(listJourney({ drivers: [] })), 0);
});

// ===========================================================================
// detailMeta — riga meta del dettaglio (CF/P.IVA + opzionali).
// ===========================================================================
test('detailMeta: CF per privato, salta telefono/cod. cliente vuoti', () => {
  assert.equal(
    detailMeta(journey({ telefono: '333', codiceCliente: 'C1', openedAt: null })),
    'CF: RSSMRA80A01H501U  ·  Tel: 333  ·  Cod. cliente: C1  ·  Aperta il —',
  );
  assert.equal(
    detailMeta(journey({ telefono: null, codiceCliente: null, openedAt: null })),
    'CF: RSSMRA80A01H501U  ·  Aperta il —',
  );
});

test('detailMeta: P.IVA per azienda', () => {
  const m = detailMeta(journey({ customerType: 'azienda', customerKey: 'IT123', telefono: null, codiceCliente: null, openedAt: null }));
  assert.equal(m, 'P.IVA: IT123  ·  Aperta il —');
});

// ===========================================================================
// DETTAGLIO — tabella Driver: intestazione + corpo (PDF vs Excel col 0).
// ===========================================================================
test('driverTableHead: 4 colonne fisse', () => {
  assert.deepEqual(driverTableHead(), ['', 'Driver', 'Stato', 'Contratti']);
});

test('driverTableBody: una riga per driver in ordine, stato/conteggio', () => {
  const d = drivers({ mobile: { activated: true, count: 2 }, fisso: { activated: false, count: 1 } });
  const pdf = driverTableBody(d, false);
  assert.equal(pdf.length, CJ_DRIVER_ORDER.length);
  // ordine = CJ_DRIVER_ORDER
  assert.deepEqual(pdf.map((r) => r[1]), CJ_DRIVER_ORDER.map(driverLabel));
  // PDF: col 0 sempre vuota (icona disegnata come immagine)
  assert.deepEqual(pdf.map((r) => r[0]), CJ_DRIVER_ORDER.map(() => ''));
  // mobile attivato con 2 contratti
  assert.deepEqual(pdf[0], ['', 'Mobile', 'Attivato', 2]);
  // fisso attivabile con 1 contratto
  assert.deepEqual(pdf[1], ['', 'Fisso', 'Attivabile', 1]);
  // driver senza dati => Attivabile, 0
  assert.deepEqual(pdf[2], ['', driverLabel(CJ_DRIVER_ORDER[2]), 'Attivabile', 0]);
});

test('driverTableBody: Excel mette l\'emoji in col 0', () => {
  const xls = driverTableBody(drivers(), true);
  assert.deepEqual(xls.map((r) => r[0]), CJ_DRIVER_ORDER.map((d) => CJ_DRIVER_EMOJI[d]));
});

// ===========================================================================
// DETTAGLIO — tabella Contratti: intestazione + mapping campi.
// ===========================================================================
test('contractsHead: include ICCID e motivo smartphone, separando la conferma manuale', () => {
  assert.deepEqual(contractsHead(), [
    '', 'Driver', 'Descrizione', 'Contratto', 'Addetto', 'PDV origine',
    'PDV destinazione effettiva', 'PDV destinazione manuale',
    'IMEI', 'RATA/CANONE', 'Inserito', 'Attivato', 'Stato', 'Esito', 'Gettone confermato', 'ICCID', 'Smartphone CJ',
    'Canale commerciale', 'Ruolo economico CJ', 'Articolo / SIM verificati',
  ]);
});

test('contractsBody: origine, destinazione effettiva e manuale restano distinte', () => {
  const rows = contractsBody([
    item({ driver: 'mobile', rata: '10', pdvDestinazioneEffettiva: 'PDV Effettivo', gettoneConfirmed: true, economicState: 'pagato' }),
    item({ driver: 'fisso', pdvDestinazione: null, pdvOrigine: 'PDV Roma', rata: null, canone: '25', imei: null, gettoneConfirmed: false }),
  ], false);
  assert.equal(rows.length, 2);
  // riga 1: col0 vuota (PDF), descrizione, contratto, addetto, PDV dest, imei, rata, stato, gettone
  assert.equal(rows[0][0], '');
  assert.equal(rows[0][1], 'Mobile');
  assert.equal(rows[0][2], 'Offerta Mobile');
  assert.equal(rows[0][3], 'CT100');
  assert.equal(rows[0][4], 'Anna');
  assert.equal(rows[0][5], 'PDV Roma');
  assert.equal(rows[0][6], 'PDV Effettivo');
  assert.equal(rows[0][7], 'PDV Milano'); // campo manuale non viene sovrascritto
  assert.equal(rows[0][8], '123456789012345');
  assert.equal(rows[0][9], '€ 10');
  assert.equal(rows[0][12], 'Attivato');
  assert.equal(rows[0][13], 'Pagato');
  assert.equal(rows[0][14], 'Sì');
  // riga 2: destinazione effettiva assente non eredita origine/manuale.
  assert.equal(rows[1][5], 'PDV Roma');
  assert.equal(rows[1][6], 'Senza destinazione');
  assert.equal(rows[1][7], '—');
  assert.equal(rows[1][8], '—');
  assert.equal(rows[1][9], '€ 25');
  assert.equal(rows[1][13], '—'); // nessun esito economico
  assert.equal(rows[1][14], 'No');
});

test('contractsBody: Excel mette l\'emoji del driver in col 0', () => {
  const rows = contractsBody([item({ driver: 'energia' })], true);
  assert.equal(rows[0][0], CJ_DRIVER_EMOJI.energia);
});

// ===========================================================================
// DETTAGLIO — header del foglio Excel.
// ===========================================================================
test('detailExcelHeaderRows: titolo, anagrafica, riga vuota finale', () => {
  const rows = detailExcelHeaderRows(journey({ customerType: 'azienda', customerKey: 'IT9', ragioneSociale: 'Acme', telefono: null, codiceCliente: null, openedAt: null }));
  assert.deepEqual(rows[0], ['Customer Journey']);
  assert.deepEqual(rows[1], ['Acme']);
  assert.deepEqual(rows[2], ['P.IVA', 'IT9']);
  assert.deepEqual(rows[3], ['Telefono', '—']);
  assert.deepEqual(rows[4], ['Cod. cliente', '—']);
  assert.deepEqual(rows[5], ['Aperta il', '—']);
  assert.deepEqual(rows[6], []);
});

// ===========================================================================
// ELENCO — sottotitolo / header con filterLabel.
// ===========================================================================
test('listSubtitle: conteggio · filtro · data; salta filtro assente', () => {
  const js = [listJourney(), listJourney()];
  const date = new Date('2026-07-10T00:00:00.000Z');
  assert.equal(
    listSubtitle(js, 'Filtro: Privati', date),
    `2 journey  ·  Filtro: Privati  ·  Esportato il ${fmtDate(date)}`,
  );
  assert.equal(
    listSubtitle(js, undefined, date),
    `2 journey  ·  Esportato il ${fmtDate(date)}`,
  );
});

test('listExcelHeaderRows: include filterLabel solo se presente', () => {
  const js = [listJourney()];
  const date = new Date('2026-07-10T00:00:00.000Z');
  const withFilter = listExcelHeaderRows(js, 'Filtro X', date);
  assert.deepEqual(withFilter[0], ['Customer Journey — Elenco']);
  assert.deepEqual(withFilter[1], ['1 journey']);
  assert.deepEqual(withFilter[2], ['Filtro X']);
  assert.deepEqual(withFilter[3], [`Esportato il ${fmtDate(date)}`]);
  assert.deepEqual(withFilter[4], []);

  const noFilter = listExcelHeaderRows(js, undefined, date);
  // senza filtro: una riga in meno
  assert.equal(noFilter.length, withFilter.length - 1);
  assert.deepEqual(noFilter[2], [`Esportato il ${fmtDate(date)}`]);
});

test('cjAppliedFilterMetadata: lists active filters, labels missing destination, omits unset filters', () => {
  const defaults = {
    typeFilter: 'tutti',
    pdvFilter: [],
    addettoFilter: 'tutti',
    stateFilter: 'tutti',
    search: '',
  };
  assert.deepEqual(cjAppliedFilterMetadata(defaults), []);

  const metadata = cjAppliedFilterMetadata({
    ...defaults,
    typeFilter: 'azienda',
    pdvFilter: ['Milano'],
    pdvOrigineFilter: ['Roma'],
    pdvDestinazioneFilter: [CJ_NO_DESTINATION_FILTER_VALUE, 'Torino'],
    ragioneSocialeFilter: ' Acme ',
    addettoFilter: 'Anna',
    stateFilter: 'pagato',
    search: 'Energia',
  }, '2026-07-01', '2026-07-31');
  assert.deepEqual(metadata, [
    { label: 'Tipo cliente', value: 'Business' },
    { label: 'PDV', value: 'Milano' },
    { label: 'PDV origine', value: 'Roma' },
    { label: 'PDV destinazione effettiva', value: 'Senza destinazione · Torino' },
    { label: 'Ragione sociale', value: 'Acme' },
    { label: 'Addetto', value: 'Anna' },
    { label: 'Stato', value: 'pagato' },
    { label: 'Ricerca', value: 'Energia' },
    { label: 'Inserimento SIM dal', value: '2026-07-01' },
    { label: 'Inserimento SIM al', value: '2026-07-31' },
  ]);

  const filterLabel = metadata.map(({ label, value }) => `${label}: ${value}`).join(' · ');
  const exportedAt = new Date('2026-07-10T00:00:00.000Z');
  assert.match(listSubtitle([listJourney()], filterLabel, exportedAt), /PDV origine: Roma/);
  assert.match(listSubtitle([listJourney()], filterLabel, exportedAt), /PDV destinazione effettiva: Senza destinazione · Torino/);
  assert.ok(listExcelHeaderRows([listJourney()], filterLabel, exportedAt).some(([text]) =>
    String(text).includes('Ragione sociale: Acme')));
});

test('actual Schede PDF/XLSX downloads preserve selected filters and long PDF summaries', { timeout: 120_000 }, async () => {
  await rm(fileTestOutput, { recursive: true, force: true });
  await mkdir(fileTestOutput, { recursive: true });

  const longCompany = `Ragione sociale filtro lungo ${'Sede commerciale Torino Nord '.repeat(10)}FINE_FILTRO_RAGIONE_SOCIALE`;
  const activeFilterLabel = [
    'PDV origine: ORIGINE_ROMA_FILTRATA',
    'PDV destinazione effettiva: DESTINAZIONE_TORINO_FILTRATA',
    `Ragione sociale: ${longCompany}`,
  ].join(' · ');
  const exportedJourney = listJourney({
    customerType: 'privato',
    nome: 'Cliente',
    cognome: 'Sintetico export filtri',
    nominativo: 'Cliente Sintetico export filtri',
    customerKey: 'CF_SINTETICO',
  });
  const cases = {
    active: { journeys: [exportedJourney], filterLabel: activeFilterLabel },
    unset: { journeys: [exportedJourney] },
  };

  const bundle = await build({
    stdin: {
      contents: `import { exportJourneyListPdf, exportJourneyListExcel } from './client/src/lib/customerJourneyExport.ts';
        const cases = ${JSON.stringify(cases)};
        for (const [name, data] of Object.entries(cases)) {
          document.querySelector('#' + name + '-pdf').onclick = () => exportJourneyListPdf(data);
          document.querySelector('#' + name + '-excel').onclick = () => exportJourneyListExcel(data);
        }`,
      resolveDir: root,
      sourcefile: 'cj-list-filter-file-harness.ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    tsconfig: path.join(root, 'tsconfig.json'),
  });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].contents
      : '<!doctype html><button id="active-pdf">PDF con filtri</button><button id="active-excel">Excel con filtri</button><button id="unset-pdf">PDF senza filtri</button><button id="unset-excel">Excel senza filtri</button><script src="/bundle.js"></script>');
  });
  let browser;
  const errors = [];
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await launchBrowser();
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);

    for (const scenario of ['active', 'unset']) {
      for (const [format, extension] of [['pdf', 'pdf'], ['excel', 'xlsx']]) {
        const pending = page.waitForEvent('download');
        await page.locator(`#${scenario}-${format}`).click();
        const download = await pending;
        assert.equal(download.suggestedFilename(), `customer_journey_elenco.${extension}`);
        await download.saveAs(path.join(fileTestOutput, `${scenario}.${extension}`));
        assert.equal(await download.failure(), null);
      }
    }
    assert.deepEqual(errors, [], 'Schede export must not throw in the browser');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }

  const activeWorkbook = XLSX.read(await readFile(path.join(fileTestOutput, 'active.xlsx')), { type: 'buffer' });
  assert.deepEqual(activeWorkbook.SheetNames, ['Elenco']);
  const activeRows = XLSX.utils.sheet_to_json(activeWorkbook.Sheets.Elenco, { header: 1, defval: '' });
  const activeExcelText = activeRows.flat().join(' ');
  for (const expected of [
    'PDV origine: ORIGINE_ROMA_FILTRATA',
    'PDV destinazione effettiva: DESTINAZIONE_TORINO_FILTRATA',
    `Ragione sociale: ${longCompany}`,
  ]) assert.ok(activeExcelText.includes(expected), `downloaded XLSX includes "${expected}"`);

  const unsetWorkbook = XLSX.read(await readFile(path.join(fileTestOutput, 'unset.xlsx')), { type: 'buffer' });
  const unsetExcelText = XLSX.utils.sheet_to_json(unsetWorkbook.Sheets.Elenco, { header: 1, defval: '' }).flat().join(' ');
  for (const absent of ['PDV origine:', 'PDV destinazione effettiva:', 'Ragione sociale:', 'ORIGINE_ROMA_FILTRATA',
    'DESTINAZIONE_TORINO_FILTRATA', 'FINE_FILTRO_RAGIONE_SOCIALE']) {
    assert.ok(!unsetExcelText.includes(absent), `unset XLSX omits "${absent}"`);
  }

  const compact = text => text.replace(/\s+/g, '');
  for (const scenario of ['active', 'unset']) {
    const bytes = await readFile(path.join(fileTestOutput, `${scenario}.pdf`));
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const pdf = await loading.promise;
    try {
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const textItems = content.items.filter(item => 'str' in item && item.str.trim());
        pages.push(textItems.map(item => item.str).join(' '));
        for (const item of textItems) {
          const [x, y] = item.transform.slice(4);
          assert.ok(x >= 28 && x + item.width <= page.view[2] - 28,
            `${scenario} PDF text stays within horizontal page bounds: ${item.str}`);
          assert.ok(y >= 20 && y <= page.view[3] - 20,
            `${scenario} PDF text stays within vertical page bounds: ${item.str}`);
        }
      }
      const pdfText = compact(pages.join(' '));
      if (scenario === 'active') {
        for (const expected of [
          'PDV origine: ORIGINE_ROMA_FILTRATA',
          'PDV destinazione effettiva: DESTINAZIONE_TORINO_FILTRATA',
          `Ragione sociale: ${longCompany}`,
        ]) assert.ok(pdfText.includes(compact(expected)), `downloaded PDF includes "${expected}"`);
        assert.ok(pdfText.includes('FINE_FILTRO_RAGIONE_SOCIALE'),
          'the end of the wrapped long filter summary is present in the PDF');
      } else {
        for (const absent of ['PDV origine:', 'PDV destinazione effettiva:', 'Ragione sociale:', 'ORIGINE_ROMA_FILTRATA',
          'DESTINAZIONE_TORINO_FILTRATA', 'FINE_FILTRO_RAGIONE_SOCIALE']) {
          assert.ok(!pdfText.includes(compact(absent)), `unset PDF omits "${absent}"`);
        }
      }
    } finally {
      await loading.destroy();
    }
  }
});

// ===========================================================================
// ELENCO — tabella PDF: 5 colonne fisse + 1 per driver (vuota in head).
// ===========================================================================
test('listPdfHead: 5 fisse + colonne driver vuote, LIST_FIXED_COLS coerente', () => {
  const head = listPdfHead();
  assert.deepEqual(head.slice(0, LIST_FIXED_COLS), ['Cliente', 'Tipo', 'CF/P.IVA', 'Stato', 'Driver']);
  assert.equal(head.length, LIST_FIXED_COLS + CJ_DRIVER_ORDER.length + 3);
  // intestazioni driver vuote (l'icona è disegnata come immagine)
  assert.deepEqual(head.slice(LIST_FIXED_COLS, LIST_FIXED_COLS + CJ_DRIVER_ORDER.length), CJ_DRIVER_ORDER.map(() => ''));
  assert.deepEqual(head.slice(-3), ['Base €', 'Extra €', 'Totale €']);
});

test('listPdfBody: tipo Business/Privato, stato, conteggio attivi, "Si"/""', () => {
  const d = drivers({ mobile: { activated: true }, fisso: { activated: true } });
  const rows = listPdfBody([
    listJourney({ customerType: 'privato', status: 'aperta', drivers: d }),
    listJourney({ customerType: 'azienda', ragioneSociale: 'Acme', customerKey: 'IT1', status: 'chiusa', drivers: [] }),
  ]);
  // riga privato
  assert.equal(rows[0][1], 'Privato');
  assert.equal(rows[0][3], 'Aperta');
  assert.equal(rows[0][4], `2/${CJ_DRIVER_ORDER.length}`);
  // colonna driver: mobile/fisso "Si", resto ""
  assert.equal(rows[0][LIST_FIXED_COLS + 0], 'Si'); // mobile
  assert.equal(rows[0][LIST_FIXED_COLS + 1], 'Si'); // fisso
  assert.equal(rows[0][LIST_FIXED_COLS + 2], ''); // energia
  // riga azienda
  assert.equal(rows[1][0], 'Acme');
  assert.equal(rows[1][1], 'Business');
  assert.equal(rows[1][2], 'IT1');
  assert.equal(rows[1][3], 'Chiusa');
  assert.equal(rows[1][4], `0/${CJ_DRIVER_ORDER.length}`);
});

// ===========================================================================
// ELENCO — tabella Excel: include Telefono + emoji header, "Sì"/"".
// ===========================================================================
test('listExcelHead: include Telefono e usa emoji per driver', () => {
  const head = listExcelHead();
  assert.deepEqual(head.slice(0, 6), ['Cliente', 'Tipo', 'CF/P.IVA', 'Telefono', 'Stato', 'Driver attivati']);
  assert.deepEqual(head.slice(6, 6 + CJ_DRIVER_ORDER.length), CJ_DRIVER_ORDER.map((d) => CJ_DRIVER_EMOJI[d]));
});

test('listExcelBody: include telefono, "Sì" per driver attivati', () => {
  const d = drivers({ energia: { activated: true } });
  const rows = listExcelBody([listJourney({ telefono: '3331234567', drivers: d })]);
  assert.equal(rows[0][3], '3331234567'); // telefono
  assert.equal(rows[0][5], `1/${CJ_DRIVER_ORDER.length}`);
  const energiaIdx = 6 + CJ_DRIVER_ORDER.indexOf('energia');
  assert.equal(rows[0][energiaIdx], 'Sì');
  const mobileIdx = 6 + CJ_DRIVER_ORDER.indexOf('mobile');
  assert.equal(rows[0][mobileIdx], '');
});

test('listExcelBody: telefono mancante => "—"', () => {
  const rows = listExcelBody([listJourney({ telefono: null })]);
  assert.equal(rows[0][3], '—');
});
