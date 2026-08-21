import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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

// Task #474: l'export PDF "Riepilogo Premi per RS" della Dashboard Gara Reale
// (PremioPerRsPdfExport) deve contenere DAVVERO header e importi, non basta
// che il download produca un PDF valido.
//
// Scenario: gara `gara_operatore_rs` in modalità `per_rs` con due Ragioni
// Sociali e la sola pista Assicurazioni attiva. Con targetS1=1 e targetS2
// irraggiungibile il premio per RS è deterministico:
//   - RS Alfa: premioS1 500 × pdvInGara 1 → € 500,00 (attuale e proiezione);
//   - RS Beta: premioS1 750 × pdvInGara 1 → € 750,00;
//   - TOTALE: € 1250,00.
//
// Quirk documentati (.agents/memory/pdf-content-assertions.md):
//   - gli header autotable possono andare a capo a metà parola → confronto
//     sul testo joined senza spazi;
//   - le celle vuote/0 non emettono token → ancoriamo le righe sul nome RS
//     (corto, così non va a capo) e contiamo solo i token € emessi.

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();
// Giorno 10 del mese corrente, lontano dai bordi timezone.
const DATA_VENDITA = `${YEAR}-${pad(MONTH)}-10T10:00:00.000Z`;

// Articolo mappato dalle regole default su assicurazioni → casaFamigliaStart
// (2 punti, quindi >= targetS1=1).
const artAssicCasa = {
  categoria: { nome: 'ASSICURAZIONI' },
  tipologia: { nome: 'ASSICURAZIONI CASA' },
  descrizione: 'CASA FAMIGLIA START',
  dettaglio: { prezzo: '5.00' },
};

async function insertSale(pool, orgId, { codicePos, nomeNegozio, ragioneSociale, articoli, stato = 'FINALIZZATA' }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        ragione_sociale, stato, totale, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      orgId,
      bisuiteId,
      DATA_VENDITA,
      codicePos,
      nomeNegozio,
      ragioneSociale,
      stato,
      '10.00',
      JSON.stringify({ cliente: { clienteTipo: 'PRIVATO' }, articoli }),
    ],
  );
}

// Estrae le stringhe testuali `(...) Tj` dal PDF jsPDF (stream non compressi).
// Stesso helper di tests/pdv-pezzi-table-ui.test.mjs.
function pdfTextTokens(buf) {
  const raw = buf.toString('latin1');
  const tokens = [];
  const re = /\(((?:\\.|[^\\()])*)\)\s*Tj/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    tokens.push(m[1].replace(/\\([()\\])/g, '$1'));
  }
  return tokens;
}

// "€ 500,00" (fmtEuro del componente) → 500. I token possono contenere il
// simbolo € in encoding WinAnsi: teniamo solo cifre e virgola.
const euroTokenToNumber = (t) => Number(t.replace(/[^\d,-]/g, '').replace(',', '.'));
const isEuroToken = (t) => /\d+,\d{2}/.test(t);

test('Dashboard Gara Reale: il PDF "Riepilogo Premi per RS" contiene header e importi seminati', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'premio_rs_pdf', fullName: 'Premio RS PDF UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('PRPOSA');
    const POS_B = uniq('PRPOSB');
    // Nomi RS corti: devono stare nella colonna da 50mm senza andare a capo,
    // così restano un singolo token `Tj` su cui ancorare la riga.
    const RS_A = uniq('PrAlfa');
    const RS_B = uniq('PrBeta');

    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [session.orgId, MONTH, YEAR, 'Premio RS PDF test', JSON.stringify({
        tipologiaGara: 'gara_operatore_rs',
        modalitaInserimentoRS: 'per_rs',
        pdvList: [
          { codicePos: POS_A, nome: 'Negozio Premio Alfa', ragioneSociale: RS_A, abilitaAssicurazioni: true },
          { codicePos: POS_B, nome: 'Negozio Premio Beta', ragioneSociale: RS_B, abilitaAssicurazioni: true },
        ],
        // Config globale richiesta dal motore assicurazioni (assicCalcMap).
        assicurazioniConfig: {
          pdvInGara: 1,
          targetNoMalus: 0,
          targetS1: 1,
          targetS2: 99999,
          premio: 500,
          premioS1: 500,
          premioS2: 900,
        },
        // Config per RS: il premio del riepilogo è premioS1 × pdvInGara.
        assicurazioniRSConfig: {
          configPerRS: [
            { ragioneSociale: RS_A, pdvInGara: 1, targetNoMalus: 0, targetS1: 1, targetS2: 99999, premio: 500, premioS1: 500, premioS2: 900 },
            { ragioneSociale: RS_B, pdvInGara: 1, targetNoMalus: 0, targetS1: 1, targetS2: 99999, premio: 750, premioS1: 750, premioS2: 1100 },
          ],
        },
      })],
    );

    // Una polizza per PDV: 2 punti ≥ targetS1 → soglia 1 per entrambe le RS.
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio Premio Alfa', ragioneSociale: RS_A, articoli: [artAssicCasa],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_B, nomeNegozio: 'Negozio Premio Beta', ragioneSociale: RS_B, articoli: [artAssicCasa],
    });
    // Una vendita ANNULLATA che NON deve alzare punti/premi.
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio Premio Alfa', ragioneSociale: RS_A,
      articoli: [artAssicCasa], stato: 'ANNULLATA',
    });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle' });

    // Card riepilogo premi visibili coi valori attesi a schermo.
    await page.getByTestId('premio-per-rs-summary').waitFor({ timeout: 30000 });
    const screenEuro = async (testId) => {
      const txt = (await page.getByTestId(testId).innerText()).trim();
      return Number(txt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    };
    assert.equal(await screenEuro(`text-premio-totale-rs-${RS_A}`), 500, 'card RS Alfa: premio attuale € 500');
    assert.equal(await screenEuro(`text-premio-totale-rs-${RS_B}`), 750, 'card RS Beta: premio attuale € 750');

    // Export PDF via dialog (colonne di default = tutte le piste attive).
    await page.getByTestId('btn-premio-rs-export-pdf').click();
    await page.getByTestId('dialog-premio-rs-pdf-export').waitFor({ timeout: 10000 });
    // La sola pista attiva (Assicurazioni) è selezionabile nel filtro.
    await page.getByTestId('checkbox-premio-rs-pdf-col-assicurazioni').waitFor({ timeout: 5000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByTestId('btn-premio-rs-pdf-confirm').click(),
    ]);
    assert.match(dl.suggestedFilename(), /^riepilogo-premi-rs_.+\.pdf$/, 'nome file PDF riepilogo premi RS');
    const pdfPath = await dl.path();
    assert.ok(pdfPath, 'download.path() PDF disponibile');

    const tokens = pdfTextTokens(fs.readFileSync(pdfPath));
    assert.ok(tokens.length > 0, 'testo estraibile dal PDF (stream non compressi)');
    const joined = tokens.join(' ');
    const joinedNoSpace = joined.replace(/\s+/g, '');

    // Titolo e header colonne (confronto senza spazi: le celle autotable
    // possono spezzare a metà parola).
    assert.ok(joinedNoSpace.includes('RiepilogoPremiperRagioneSociale'), `PDF: titolo presente (testo: ${joined.slice(0, 300)})`);
    for (const h of ['RagioneSociale', 'PremioAttuale', 'PremioProiezione', 'Assicurazioni-Attuale', 'Assicurazioni-Proiezione']) {
      assert.ok(joinedNoSpace.includes(h), `PDF: header "${h}" presente (testo: ${joinedNoSpace.slice(0, 400)})`);
    }

    // Riga RS Alfa: RS, Premio Attuale, Premio Proiezione, Assic Attuale,
    // Assic Proiezione → 4 celle € tutte a 500 (S1 raggiunta anche in
    // proiezione, targetS2 irraggiungibile).
    const rowEuro = (anchor, count) => {
      const idx = tokens.indexOf(anchor);
      assert.ok(idx >= 0, `PDF: riga "${anchor}" presente (tokens: ${tokens.join('|').slice(0, 500)})`);
      return tokens.slice(idx + 1, idx + 1 + count * 3)
        .filter(isEuroToken)
        .map(euroTokenToNumber)
        .slice(0, count);
    };
    assert.deepEqual(rowEuro(RS_A, 4), [500, 500, 500, 500], 'PDF: riga RS Alfa = € 500 su tutte le colonne (annullata esclusa)');
    assert.deepEqual(rowEuro(RS_B, 4), [750, 750, 750, 750], 'PDF: riga RS Beta = € 750 su tutte le colonne');

    // Riga TOTALE: 500 + 750 = 1250 su premio attuale/proiezione e sulla
    // colonna Assicurazioni.
    assert.deepEqual(rowEuro('TOTALE', 4), [1250, 1250, 1250, 1250], 'PDF: riga TOTALE = € 1250 su tutte le colonne');

    // Le RS sono ordinate per premio attuale decrescente: Beta (750) prima di Alfa (500).
    assert.ok(tokens.indexOf(RS_B) < tokens.indexOf(RS_A), 'PDF: RS Beta (750) prima di RS Alfa (500)');

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
