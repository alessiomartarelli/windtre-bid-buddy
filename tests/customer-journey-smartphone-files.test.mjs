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
import { contractsBody, contractsHead, detailFileBase, journeyGettoneRows } from '../shared/customerJourneyExport.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'generated-artifacts/cj-smartphone-files');
// Deliberately longer than Excel's numeric precision, including leading zeroes.
const A = '89000000000000000001', B = '00123456789012345678';
const july = '2026-07-09T00:00:00.000Z', august = '2026-08-09T00:00:00.000Z';
const journey = {
  id: 'synthetic-files', customerKey: 'SYNTHETIC', customerType: 'privato',
  nominativo: 'Cliente sintetico export smartphone', openedAt: july,
  triggerSaleId: 'sale-a', triggerBisuiteId: 101,
};
const item = (id, driver, sale, iccid, date, description) => ({
  id: `${driver}-${id}`, driver, categoria: driver === 'mobile' ? 'TIED CF' : 'TELEFONIA',
  tipologia: driver === 'mobile' ? 'VOCE EASYPAY' : 'SMARTPHONE',
  descrizione: description, bisuiteArticleId: id, bisuiteSaleId: sale,
  iccid, cjTriggerMobile: id === 1, state: 'inserito', economicState: null,
  dataInserimento: date, dataAttivazione: null, codiceContratto: `SYN-${id}`,
});
const longDescription = 'Descrizione sintetica estesa con dettagli commerciali e condizioni del dispositivo. '.repeat(4);
const items = [
  item(1, 'mobile', 'sale-a', A, july, `SIM iniziale ${longDescription} FINE-SIM-INIZIALE`),
  item(2, 'telefono', 'sale-a', A, july, `Smartphone iniziale ${longDescription} FINE-PHONE-INIZIALE`),
  item(10, 'mobile', 'sale-b', B, august, `SIM extra ${longDescription} FINE-SIM-EXTRA`),
  item(11, 'telefono', 'sale-b', B, august, `Smartphone extra ${longDescription} FINE-PHONE-EXTRA`),
];
const sales = [
  { saleId: 'sale-a', date: july, pdv: 'PDV iniziale', articles: [
    { articleId: 1, category: 'TIED CF', description: items[0].descrizione, iccid: A },
  ] },
  { saleId: 'sale-b', date: august, pdv: 'PDV extra', articles: [
    { articleId: 10, category: 'UNTIED', description: items[2].descrizione, iccid: B },
  ] },
];
// Enough rows for several provenance pages; unique tail markers catch truncation.
for (let i = 0; i < 18; i++) {
  items.push(item(100 + i, 'telefono', `cb-${i}`, A, august,
    `Smartphone CB ${i} ${longDescription} FINE-PHONE-CB-${i}`));
  sales.push({ saleId: `cb-${i}`, date: august, pdv: 'PDV CB', articles: [
    { articleId: 200 + i, category: 'RIVINCOLO',
      description: `Rivincolo ${i} ${longDescription} FINE-REF-CB-${i}`, iccid: A },
  ] });
}
const data = { journey, items, drivers: [], phoneCommercialSales: sales };
const compact = text => text.replace(/\s+/g, '');

test('actual smartphone PDF/XLSX downloads preserve provenance, ICCIDs and amounts', { timeout: 120_000 }, async () => {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  // Bundle the actual client module, not a reimplementation of the export.
  // Only the buttons/data are synthetic: save(), writeFile(), icons and tables are real.
  const bundle = await build({
    stdin: {
      contents: `import { exportJourneyPdf, exportJourneyExcel } from './client/src/lib/customerJourneyExport.ts';
        const data = ${JSON.stringify(data)};
        document.querySelector('#pdf').onclick = () => exportJourneyPdf(data);
        document.querySelector('#excel').onclick = () => exportJourneyExcel(data);`,
      resolveDir: root, sourcefile: 'cj-smartphone-file-harness.ts',
    },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    tsconfig: path.join(root, 'tsconfig.json'),
  });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].contents
      : '<!doctype html><button id="pdf">PDF</button><button id="excel">Excel</button><script src="/bundle.js"></script>');
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
    for (const [button, extension] of [['pdf', 'pdf'], ['excel', 'xlsx']]) {
      const pending = page.waitForEvent('download');
      await page.locator(`#${button}`).click();
      const download = await pending;
      assert.equal(download.suggestedFilename(), `${detailFileBase(journey)}.${extension}`);
      await download.saveAs(path.join(output, `smartphones.${extension}`));
      assert.equal(await download.failure(), null);
    }
    assert.deepEqual(errors, [], 'client export must not throw');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }

  const workbook = XLSX.read(await readFile(path.join(output, 'smartphones.xlsx')), { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['Driver', 'Contratti', 'Gettoni']);
  const sheet = workbook.Sheets.Contratti;
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  assert.deepEqual(rows[0], contractsHead());
  assert.deepEqual(rows.slice(1), contractsBody(items, true, journey, sales));
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets.Gettoni, { header: 1 }), journeyGettoneRows(journey, items));
  for (let i = 0; i < items.length; i++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: i + 1, c: 15 })];
    assert.equal(cell.t, 's', 'ICCID must remain a text cell, never numeric/scientific notation');
    assert.equal(cell.v, items[i].iccid);
    if (items[i].driver === 'telefono') {
      for (const column of [17, 18, 19]) {
        assert.equal(sheet[XLSX.utils.encode_cell({ r: i + 1, c: column })].t, 's');
      }
    }
  }
  assert.equal(new Map(journeyGettoneRows(journey, items)).get('Totale stimato'), 40);
  assert.match(rows[2][16], /SIM iniziale/);
  assert.match(rows[4][16], /Coppia successiva/);
  assert.equal(rows[5][18], 'Escluso dal gettone CJ');

  const bytes = await readFile(path.join(output, 'smartphones.pdf'));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await loading.promise;
  try {
    const pages = [];
    const provenance = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const text = content.items.filter(it => 'str' in it);
      const joined = compact(text.map(it => it.str).join(' '));
      pages.push(joined);
      if (!joined.includes('Canalecommerciale')) continue;
      provenance.push(p);
      for (const header of ['Smartphone', ...contractsHead().slice(17)]) {
        assert.ok(joined.includes(compact(header)), `repeated provenance header "${header}" on page ${p}`);
      }
      for (const token of text.filter(it => it.str.trim())) {
        const fontSize = Math.hypot(token.transform[2], token.transform[3]);
        assert.ok(fontSize >= 7.9, `provenance text stays readable, page ${p}: ${token.str}`);
        const [x, y] = token.transform.slice(4);
        assert.ok(x >= 35 && x + token.width <= page.view[2] - 30, `no horizontal clipping on page ${p}: ${token.str}`);
        assert.ok(y >= 35 && y <= page.view[3] - 30, `no vertical clipping on page ${p}: ${token.str}`);
      }
    }
    assert.ok(provenance.length >= 3, 'fixture must exercise multipage provenance, not just contracts');
    const provenanceText = provenance.map(p => pages[p - 1]).join('');
    const expected = contractsBody(items, false, journey, sales);
    for (const [i, it] of items.entries()) {
      if (it.driver !== 'telefono') continue;
      const rowPage = provenance.find(p => pages[p - 1].includes(compact(`Contratto: ${it.codiceContratto}`)));
      assert.ok(rowPage, `smartphone ${it.id} has an identifiable provenance row`);
      for (const value of [it.descrizione, `Contratto: ${it.codiceContratto}`,
        `ICCID smartphone: ${it.iccid}`, ...expected[i].slice(15)]) {
        assert.ok(provenanceText.includes(compact(String(value))), `PDF preserves smartphone ${it.id}: ${value}`);
        assert.ok(pages[rowPage - 1].includes(compact(String(value))),
          `smartphone, channel, role and complete references stay together on page ${rowPage}: ${it.id}`);
      }
    }
    console.log(`Verified downloaded XLSX: ${items.length} contracts; PDF: ${pdf.numPages} pages, provenance on pages ${provenance.join(', ')}.`);
  } finally {
    await loading.destroy();
  }
});
