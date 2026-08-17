import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  uniq,
  signup,
  cleanupOrg,
  newPool,
  launchBrowser,
  newAuthedContext,
} from './helpers/uiTest.mjs';

// Task #414: il grafico "Andamento KPI nel periodo" (Vendite BiSuite,
// GraficoAndamentoPezzi + memo andamentoPezzi) deve restare corretto.
//
// Copre:
//   - parità dei numeri con la Tabella PDV × Pista (Pezzi): stessi filtri,
//     vendite ANNULLATA escluse; la somma del "Totale pezzi" sui giorni del
//     grafico = totale complessivo della tabella;
//   - bucketizzazione per giorno di calendario ITALIANO: day = primi 10
//     caratteri della stringa ISO di data_vendita, MAI new Date()+format
//     locale. Caso critico: vendita a mezzanotte italiana (00:10) con
//     browser in timezone America/New_York — una bucketizzazione locale la
//     sposterebbe sul giorno PRIMA (creando un bucket extra fuori periodo);
//   - zero-fill dei giorni senza vendite nel periodo filtrato (sia il giorno
//     vuoto in mezzo ai dati, sia il giorno iniziale del filtro senza dati);
//   - toggle delle serie (btn-trend-*): aria-pressed, numero di linee rese,
//     regola "almeno una serie sempre attiva";
//   - contatori extra IVA/CB/Telefoni (stesse regole shared/pdvPezziExtra
//     della tabella: IVA/CB per categoria BiSuite di origine).

const NOW = new Date();
const ym = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`;
// Giorni fissi del mese corrente (il filtro default della pagina è il mese
// corrente, quindi sono sempre dentro il periodo; poi il test restringe il
// filtro a day4..day7 per avere un numero noto di punti sul grafico).
const day4 = `${ym}-04`;
const day5 = `${ym}-05`;
const day6 = `${ym}-06`;
const day7 = `${ym}-07`;
const label = (d) => {
  const [, m, g] = d.split('-');
  return `${g}/${m}`;
};

let nextBisuiteId = 414_000_000 + Math.floor(Math.random() * 1_000_000);

// Inserisce una vendita con data_vendita ESPLICITA (wall-time italiano,
// colonna timestamp senza fuso) e un singolo articolo della categoria data.
async function insertSale(pool, orgId, { when, categoria, tipologia = 'OFFERTA', descrizione, stato = 'FINALIZZATA' }) {
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        nome_addetto, nome_cliente, totale, stato, ragione_sociale, raw_data)
     VALUES ($1, $2, $3::timestamp, 'POSA1', 'Negozio Andamento',
             'Addetto Trend', 'Cliente Trend', '10.00', $4, 'Andamento Srl', $5::jsonb)`,
    [
      orgId,
      nextBisuiteId++,
      when,
      stato,
      JSON.stringify({
        articoli: [
          {
            categoria: { nome: categoria },
            tipologia: { nome: tipologia },
            descrizione: descrizione ?? `Offerta ${categoria}`,
            dettaglio: { prezzo: '10.00' },
          },
        ],
      }),
    ],
  );
}

// Poll finché il testo del locator non coincide (le date del filtro
// scatenano un refetch asincrono della query vendite).
async function waitForText(locator, expected, what, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last = '(mai letto)';
  while (Date.now() < deadline) {
    last = (await locator.innerText().catch(() => '(non visibile)')).trim();
    if (last === expected) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.fail(`${what}: atteso "${expected}", trovato "${last}"`);
}

// Legge il tooltip recharts dopo l'hover sul punto (cx del dot, centro Y del
// grafico: il tooltip di recharts è per-ascissa, non serve centrare il dot).
// Il tooltip resta visibile fra un hover e l'altro e si aggiorna in modo
// asincrono: bisogna ATTENDERE che mostri la label del giorno atteso, non
// leggere il primo testo visibile (sotto carico si leggerebbe il giorno
// dell'hover precedente).
async function tooltipTextAt(page, chart, dot, expectedLabel) {
  await chart.scrollIntoViewIfNeeded();
  const box = await dot.boundingBox();
  assert.ok(box, 'bounding box del dot disponibile');
  const chartBox = await chart.boundingBox();
  const tooltip = chart.locator('.recharts-tooltip-wrapper');
  const deadline = Date.now() + 10000;
  let text = '(tooltip mai visibile)';
  while (Date.now() < deadline) {
    await page.mouse.move(box.x + box.width / 2, chartBox.y + chartBox.height / 2, { steps: 4 });
    const t = await tooltip.innerText().catch(() => null);
    if (t != null) {
      text = t.replace(/\s+/g, ' ').trim();
      if (text.includes(expectedLabel)) return text;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.fail(`tooltip: label attesa "${expectedLabel}" mai apparsa (ultimo testo: "${text}")`);
}

test('Vendite BiSuite: grafico Andamento KPI — parità con tabella, giorni italiani anche con browser non-Rome, zero-fill, toggle serie, extra IVA/CB/Telefoni', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'trend_kpi', fullName: 'Andamento KPI UI Test', organizationName: uniq('TrendKpiOrg') });
  let browser;
  try {
    // Seed:
    //   day5: 2 mobile (UNA a mezzanotte 00:10 — caso timezone) + 1 fisso
    //         + 1 mobile ANNULLATA (da escludere ovunque)
    //   day6: nessuna vendita (zero-fill in mezzo ai dati)
    //   day7: 1 energia + 1 assicurazioni + 1 TIED IVA (mobile + pezzo IVA)
    //         + 1 RIVINCOLO (CB) + 1 TELEFONIA (telefoni)
    const seeds = [
      { when: `${day5} 00:10:00`, categoria: 'UNTIED' },
      { when: `${day5} 12:00:00`, categoria: 'UNTIED' },
      { when: `${day5} 13:00:00`, categoria: 'ADSL/FIBRA/FWA CF' },
      { when: `${day5} 14:00:00`, categoria: 'UNTIED', stato: 'ANNULLATA' },
      { when: `${day7} 10:00:00`, categoria: 'ENERGIA W3' },
      { when: `${day7} 10:30:00`, categoria: 'ASSICURAZIONI' },
      { when: `${day7} 11:00:00`, categoria: 'TIED IVA' },
      { when: `${day7} 11:30:00`, categoria: 'RIVINCOLO' },
      { when: `${day7} 12:00:00`, categoria: 'TELEFONIA' },
    ];
    for (const s of seeds) await insertSale(pool, session.orgId, s);

    // Attesi (ANNULLATA esclusa):
    //   day4: 0 (zero-fill dal filtro), day5: 2 mobile + 1 fisso = 3,
    //   day6: 0, day7: mobile(TIED IVA)+energia+assicurazioni = 3.
    // Tabella: mobile 3, fisso 1, energia 1, assicurazioni 1, generale 6,
    // extra: iva 1, cb 1, telefoni 1.  Somma "Totale pezzi" grafico = 6.

    browser = await launchBrowser();
    // Browser FUORI da Europe/Rome: se la bucketizzazione usasse
    // new Date()+formato locale, la vendita delle 00:10 (ISO "...T00:10:00Z")
    // finirebbe sul giorno prima (America/New_York = UTC-4/-5).
    const context = await newAuthedContext(browser, session, { timezoneId: 'America/New_York' });
    const page = await context.newPage();
    await page.goto(`${BASE}/vendite-bisuite`, { waitUntil: 'networkidle' });

    // Restringi il periodo a day4..day7 (day4 senza vendite: lo zero-fill
    // deve coprire anche l'inizio del periodo filtrato, non solo i buchi).
    await page.getByTestId('input-from-date').fill(day4);
    await page.getByTestId('input-to-date').fill(day7);

    // ── Parità con la Tabella PDV × Pista (Pezzi) ──
    const card = page.locator('[data-testid="card-tabella-pdv-pista-pezzi"]');
    await card.waitFor({ state: 'visible', timeout: 20000 });
    await waitForText(page.getByTestId('cell-pezzi-tot-generale'), '6', 'tabella: totale generale (ANNULLATA esclusa)');
    assert.equal((await page.getByTestId('cell-pezzi-tot-mobile').innerText()).trim(), '3', 'tabella: mobile');
    assert.equal((await page.getByTestId('cell-pezzi-tot-fisso').innerText()).trim(), '1', 'tabella: fisso');
    assert.equal((await page.getByTestId('cell-pezzi-tot-energia').innerText()).trim(), '1', 'tabella: energia');
    assert.equal((await page.getByTestId('cell-pezzi-tot-assicurazioni').innerText()).trim(), '1', 'tabella: assicurazioni');
    assert.equal((await page.getByTestId('cell-pezzi-tot-iva').innerText()).trim(), '1', 'tabella: extra IVA');
    assert.equal((await page.getByTestId('cell-pezzi-tot-cb').innerText()).trim(), '1', 'tabella: extra CB');
    assert.equal((await page.getByTestId('cell-pezzi-tot-telefoni').innerText()).trim(), '1', 'tabella: extra Telefoni');

    // ── Grafico visibile con i toggle delle serie (extra inclusi) ──
    const chartCard = page.locator('[data-testid="card-andamento-pezzi"]');
    await chartCard.waitFor({ state: 'visible', timeout: 20000 });
    const chart = page.locator('[data-testid="chart-andamento-pezzi"]');
    for (const key of ['mobile', 'fisso', 'energia', 'assicurazioni', 'totale', 'iva', 'cb', 'telefoni']) {
      assert.equal(await page.getByTestId(`btn-trend-${key}`).count(), 1, `toggle btn-trend-${key} presente (hasExtra=true)`);
    }
    // Default: le 4 piste attive → 4 linee rese.
    assert.equal(await page.getByTestId('btn-trend-mobile').getAttribute('aria-pressed'), 'true', 'default: mobile attiva');
    assert.equal(await page.getByTestId('btn-trend-totale').getAttribute('aria-pressed'), 'false', 'default: totale spenta');
    await chart.locator('.recharts-line').first().waitFor({ state: 'attached', timeout: 10000 });
    assert.equal(await chart.locator('.recharts-line').count(), 4, 'default: 4 linee (una per pista)');

    // ── Toggle: lascia attivo SOLO "Totale pezzi" ──
    await page.getByTestId('btn-trend-totale').click();
    for (const key of ['mobile', 'fisso', 'energia', 'assicurazioni']) {
      await page.getByTestId(`btn-trend-${key}`).click();
      assert.equal(await page.getByTestId(`btn-trend-${key}`).getAttribute('aria-pressed'), 'false', `toggle: ${key} spenta`);
    }
    assert.equal(await chart.locator('.recharts-line').count(), 1, 'toggle: resta la sola linea Totale');
    // Regola "almeno una serie": cliccare l'unica attiva non la spegne.
    await page.getByTestId('btn-trend-totale').click();
    assert.equal(await page.getByTestId('btn-trend-totale').getAttribute('aria-pressed'), 'true', 'almeno una serie sempre attiva');
    assert.equal(await chart.locator('.recharts-line').count(), 1, 'la linea Totale resta resa');

    // ── Bucketizzazione + zero-fill: 4 punti (day4..day7), niente bucket
    // extra dal giorno "americano" della vendita di mezzanotte ──
    const dots = chart.locator('.recharts-line-dot');
    assert.equal(
      await dots.count(),
      4,
      'grafico: 4 punti (day4 zero-fill filtro, day5, day6 zero-fill, day7) — un 5° punto = vendita di mezzanotte bucketizzata col fuso del browser',
    );

    // ── Valori per giorno via tooltip (label dd/mm + "Totale pezzi : N") ──
    const expectedTotals = [
      { day: day4, tot: 0 },
      { day: day5, tot: 3 }, // include la vendita delle 00:10 italiane
      { day: day6, tot: 0 },
      { day: day7, tot: 3 },
    ];
    for (let i = 0; i < expectedTotals.length; i++) {
      const { day, tot } = expectedTotals[i];
      const text = await tooltipTextAt(page, chart, dots.nth(i), label(day));
      assert.ok(text.includes(`Totale pezzi : ${tot}`), `tooltip ${label(day)}: Totale pezzi = ${tot} (trovato: "${text}")`);
    }
    // Parità: la somma dei totali giornalieri (0+3+0+3) = totale tabella (6).

    // ── Serie extra IVA/CB/Telefoni sul grafico ──
    for (const key of ['iva', 'cb', 'telefoni']) await page.getByTestId(`btn-trend-${key}`).click();
    assert.equal(await chart.locator('.recharts-line').count(), 4, 'totale + 3 serie extra attive');
    // day7 (4° punto della prima linea): IVA/CB/Telefoni = 1.
    const day7Text = await tooltipTextAt(page, chart, chart.locator('.recharts-line').first().locator('.recharts-line-dot').nth(3), label(day7));
    for (const [name, v] of [['IVA', 1], ['CB', 1], ['Telefoni', 1]]) {
      assert.ok(day7Text.includes(`${name} : ${v}`), `tooltip ${label(day7)}: ${name} = ${v} (trovato: "${day7Text}")`);
    }
    // day5: nessun pezzo extra (le 2 UNTIED + fisso non sono IVA/CB/Telefoni).
    const day5Text = await tooltipTextAt(page, chart, chart.locator('.recharts-line').first().locator('.recharts-line-dot').nth(1), label(day5));
    for (const name of ['IVA', 'CB', 'Telefoni']) {
      assert.ok(day5Text.includes(`${name} : 0`), `tooltip ${label(day5)}: ${name} = 0 (trovato: "${day5Text}")`);
    }

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
