import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test suite del motore di esito economico Customer Journey ← DRMS.
// Logica PURA di `shared/customerJourneyDrms.ts` (+ `isCjItemActive` di
// `shared/customerJourney.ts`): NON serve né dev server né DB, i moduli TS
// sono caricati via loader `tsx`.
//
// Le righe di fixture ricalcano la forma delle righe dell'"Estratto conto"
// del DRMS di esempio (attached_assets/gruppo_cms_drms_feb_26_*.xlsx) così
// come vengono normalizzate dal client (drmsClassifier): NATURA, TIPO_FONIA,
// TIPO_TRANSAZIONE, DESCRIZIONE_EVENTO, CAUSALE_STORNO, IMPORTO(_NUM),
// COMPETENZA 'YYYY-MM', DATA_EVENTO 'YYYY-MM-DD', CODICE_CONTRATTO,
// FISCAL_CODE, P_IVA_CLIENTE, POD_PDR. Valori anagrafici anonimizzati.

const drmsMod = await import('../shared/customerJourneyDrms.ts');
const {
  computeDrmsOutcomes,
  classifyDrmsRow,
  normalizeCompetenza,
  applyOutcomeToState,
  DRMS_WINDOW_MONTHS,
} = drmsMod;
const { isCjItemActive } = await import('../shared/customerJourney.ts');

let seq = 62572570000000;
function row(over = {}) {
  seq += 1;
  return {
    SEQ_ID: String(seq),
    NATURA: 'CONTRATTUALE',
    TIPO_TRANSAZIONE: 'Activation',
    TIPO_FONIA: 'MOBILE',
    DESCRIZIONE_EVENTO: 'Contrattuale Attivazioni Mobile',
    CAUSALE_STORNO: '',
    IMPORTO: '5',
    IMPORTO_NUM: 5,
    COMPETENZA: '2026-02',
    DATA_EVENTO: '2026-02-17',
    CODICE_CONTRATTO: 'C-MOB-1',
    FISCAL_CODE: 'RSSMRA80A01H501U',
    P_IVA_CLIENTE: '',
    POD_PDR: '',
    DT_ATTIVAZIONE: '2026-02-10',
    ...over,
  };
}
// Riga "GARE" (stessa forma, NATURA diversa): NON concorre all'esito.
const gara = (over = {}) => row({ NATURA: 'GARE', DESCRIZIONE_EVENTO: 'Gara Reload Forever', IMPORTO: '20', IMPORTO_NUM: 20, ...over });

function item(over = {}) {
  return {
    id: over.id ?? 'it1',
    driver: 'mobile',
    codiceContratto: 'C-MOB-1',
    cf: 'RSSMRA80A01H501U',
    piva: null,
    pod: null,
    pdr: null,
    dataInserimento: '2026-02-10T10:00:00.000Z',
    ...over,
  };
}

const outcomeOf = (rows, it) => computeDrmsOutcomes(rows, [it]).outcomes.get(it.id);

// ===========================================================================
// Classificazione righe
// ===========================================================================
test('classifyDrmsRow: solo CONTRATTUALE conta; GARE e importo 0 senza causale ignorati', () => {
  assert.deepEqual(classifyDrmsRow(row()), { kind: 'credit' });
  assert.equal(classifyDrmsRow(gara()), null);
  assert.equal(classifyDrmsRow(row({ IMPORTO: '0', IMPORTO_NUM: 0, CAUSALE_STORNO: '' })), null);
  assert.equal(classifyDrmsRow(row({ IMPORTO: '0', IMPORTO_NUM: 0, CAUSALE_STORNO: 'DISDETTA RECESSO' })), null,
    'importo 0 con DISDETTA RECESSO non è annullamento (né storno): ignorato');
  assert.deepEqual(classifyDrmsRow(row({ IMPORTO: '0', IMPORTO_NUM: 0, CAUSALE_STORNO: 'DINIEGO' })), { kind: 'annullato' });
  assert.deepEqual(classifyDrmsRow(row({ IMPORTO: '0', IMPORTO_NUM: 0, CAUSALE_STORNO: 'POPI ESTESA' })), { kind: 'annullato' });
  assert.deepEqual(classifyDrmsRow(row({ IMPORTO: '-5', IMPORTO_NUM: -5, CAUSALE_STORNO: 'DISDETTA RECESSO' })), { kind: 'storno' });
  // Adjustment manuale "Storno Compensi" conta come storno anche se NATURA non è CONTRATTUALE
  assert.deepEqual(classifyDrmsRow(row({
    NATURA: 'GARE', TIPO_TRANSAZIONE: 'Adjustment Manuali', DESCRIZIONE_EVENTO: 'Storno Compensi Contrattuale',
    IMPORTO: '-10', IMPORTO_NUM: -10,
  })), { kind: 'storno' });
  // Adjustment "Compensi Gare" positivo NON è un evento d'esito
  assert.equal(classifyDrmsRow(row({
    NATURA: 'GARE', TIPO_TRANSAZIONE: 'Adjustment Manuali', DESCRIZIONE_EVENTO: 'Compensi Gare', IMPORTO: '50', IMPORTO_NUM: 50,
  })), null);
});

test('normalizeCompetenza: formati YYYY-MM, YYYYMM, YYYY-MM-DD, MMM-YY', () => {
  assert.equal(normalizeCompetenza('2026-02'), '2026-02');
  assert.equal(normalizeCompetenza('202602'), '2026-02');
  assert.equal(normalizeCompetenza('2026-2-1'), '2026-02');
  assert.equal(normalizeCompetenza('FEB-26'), '2026-02');
  assert.equal(normalizeCompetenza('feb-2026'), '2026-02');
  assert.equal(normalizeCompetenza(''), null);
  assert.equal(normalizeCompetenza('boh'), null);
});

// ===========================================================================
// Regole di esito
// ===========================================================================
test('pagato: riga CONTRATTUALE con importo > 0 e nessuna causale', () => {
  const out = outcomeOf([row(), gara()], item());
  assert.equal(out?.state, 'pagato');
  assert.equal(out.competenza, '2026-02');
  assert.equal(out.outcomeCompetenza, '2026-02');
  assert.equal(out.importo, 5);
  assert.equal(out.matchBy, 'contratto');
  assert.deepEqual(out.contratti, ['C-MOB-1']);
  assert.equal(out.ambiguous, false);
});

test('annullato: importo 0 con causale DINIEGO/POPI/…; NP INTERNA con importo > 0 è pagato', () => {
  for (const c of ['DINIEGO', 'POPI', 'POPI ESTESA', 'DISCONOSCIMENTO', 'KO_REITERO', 'NP INTERNA']) {
    const out = outcomeOf([row({ IMPORTO: '0', IMPORTO_NUM: 0, CAUSALE_STORNO: c })], item());
    assert.equal(out?.state, 'annullato', `causale ${c}`);
    assert.equal(out.causale, c);
  }
  const paid = outcomeOf([row({ IMPORTO: '5', IMPORTO_NUM: 5, CAUSALE_STORNO: 'NP INTERNA' })], item());
  assert.equal(paid?.state, 'pagato');
});

test('stornato: importo < 0 (DISDETTA RECESSO / CLIENTE IRREGOLARE / PDA) o adjustment Storno Compensi', () => {
  for (const c of ['DISDETTA RECESSO', 'CLIENTE IRREGOLARE', 'PDA']) {
    const out = outcomeOf([
      row({ COMPETENZA: '2026-01', DATA_EVENTO: '2026-01-10' }),
      row({ IMPORTO: '-5', IMPORTO_NUM: -5, CAUSALE_STORNO: c, COMPETENZA: '2026-03', DATA_EVENTO: '2026-03-01' }),
    ], item({ dataInserimento: '2026-01-05T00:00:00.000Z' }));
    assert.equal(out?.state, 'stornato', `causale ${c}`);
    assert.equal(out.competenza, '2026-01', 'competenza contratto = prima riga CONTRATTUALE');
    assert.equal(out.outcomeCompetenza, '2026-03');
    assert.equal(out.causale, c);
    assert.equal(out.importo, -5);
    assert.deepEqual(out.history.map((h) => h.state), ['pagato', 'stornato']);
  }
  // storno manuale riferito al CF (nessun codice contratto sulla riga adjustment)
  const out = outcomeOf([
    row({ COMPETENZA: '2026-01', DATA_EVENTO: '2026-01-10', TIPO_FONIA: 'ENERGIA', CODICE_CONTRATTO: 'C-EN-9', POD_PDR: 'IT001E123' }),
    row({
      NATURA: 'GARE', TIPO_TRANSAZIONE: 'Adjustment Manuali', DESCRIZIONE_EVENTO: 'Storno Compensi Contrattuale',
      TIPO_FONIA: 'ENERGIA', CODICE_CONTRATTO: '', POD_PDR: '', IMPORTO: '-10', IMPORTO_NUM: -10,
      COMPETENZA: '2026-02', DATA_EVENTO: '2026-02-01',
    }),
  ], item({ driver: 'energia', codiceContratto: 'BISUITE-X', pod: 'IT001E123', dataInserimento: '2026-01-05T00:00:00.000Z' }));
  // Match per POD → contratto C-EN-9 pagato; lo storno senza codice pesa sul CF
  // ma il POD trova già un contratto: preferenza pagato.
  assert.equal(out?.state, 'pagato');
  const outCf = outcomeOf([
    row({
      NATURA: 'GARE', TIPO_TRANSAZIONE: 'Adjustment Manuali', DESCRIZIONE_EVENTO: 'Storno Compensi Contrattuale',
      TIPO_FONIA: 'ENERGIA', CODICE_CONTRATTO: '', POD_PDR: '', IMPORTO: '-10', IMPORTO_NUM: -10,
      COMPETENZA: '2026-02', DATA_EVENTO: '2026-02-01',
    }),
  ], item({ driver: 'energia', codiceContratto: 'BISUITE-X', pod: 'IT001E999', dataInserimento: '2026-01-05T00:00:00.000Z' }));
  assert.equal(outCf?.state, 'stornato', 'senza match POD, lo storno manuale per CF+ENERGIA determina lo stato');
  assert.equal(outCf.matchBy, 'cf');
  assert.deepEqual(outCf.contratti, [], 'nessun codice contratto DRMS reale agganciato');
});

test('riaccreditato: importo > 0 dopo uno storno in competenza precedente; precedenza temporale per COMPETENZA', () => {
  const rows = [
    row({ COMPETENZA: '2026-01', DATA_EVENTO: '2026-01-10' }),
    row({ IMPORTO: '-5', IMPORTO_NUM: -5, CAUSALE_STORNO: 'CLIENTE IRREGOLARE', COMPETENZA: '2026-02', DATA_EVENTO: '2026-02-03' }),
    row({ COMPETENZA: '2026-04', DATA_EVENTO: '2026-04-15' }),
  ];
  // ordine di arrivo diverso dall'ordine temporale
  const out = outcomeOf([rows[2], rows[0], rows[1]], item({ dataInserimento: '2026-01-05T00:00:00.000Z' }));
  assert.equal(out?.state, 'riaccreditato');
  assert.deepEqual(out.history.map((h) => [h.competenza, h.state]), [
    ['2026-01', 'pagato'], ['2026-02', 'stornato'], ['2026-04', 'riaccreditato'],
  ]);
  assert.equal(out.outcomeCompetenza, '2026-04');
  // Un credito senza storno precedente NON è riaccredito
  const paid = outcomeOf([rows[0], rows[2]], item({ dataInserimento: '2026-01-05T00:00:00.000Z' }));
  assert.equal(paid?.state, 'pagato');
});

test('stessa competenza: si valuta il saldo netto (opzione stornata −5 + attivazione +30 = pagato)', () => {
  const out = outcomeOf([
    row({ IMPORTO: '30', IMPORTO_NUM: 30, DATA_EVENTO: '2026-02-05' }),
    row({ TIPO_TRANSAZIONE: 'Usim Option', DESCRIZIONE_EVENTO: 'Gara Reload Forever', IMPORTO: '-5', IMPORTO_NUM: -5, CAUSALE_STORNO: 'DISDETTA RECESSO', DATA_EVENTO: '2026-02-20' }),
  ], item());
  assert.equal(out?.state, 'pagato');
  assert.equal(out.importo, 30, 'riga di riferimento = ultimo credito');
});

test('annullamento a importo 0 dopo un pagato non altera lo stato', () => {
  const out = outcomeOf([
    row({ COMPETENZA: '2026-01', DATA_EVENTO: '2026-01-10' }),
    row({ IMPORTO: '0', IMPORTO_NUM: 0, CAUSALE_STORNO: 'DINIEGO', COMPETENZA: '2026-02' }),
  ], item({ dataInserimento: '2026-01-05T00:00:00.000Z' }));
  assert.equal(out?.state, 'pagato');
});

test('contratto senza riga CONTRATTUALE (solo GARE) ⇒ nessun esito', () => {
  const r = computeDrmsOutcomes([gara(), gara({ COMPETENZA: '2026-03' })], [item()]);
  assert.equal(r.outcomes.get('it1'), null);
  assert.equal(r.summary.notFound, 1);
  assert.equal(r.summary.matched, 0);
});

// ===========================================================================
// Match per driver
// ===========================================================================
test('match per codice contratto è case/space-insensitive; fallback CF + TIPO_FONIA', () => {
  const byCode = outcomeOf([row({ CODICE_CONTRATTO: ' c-mob-1 ' })], item());
  assert.equal(byCode?.state, 'pagato');
  assert.equal(byCode.matchBy, 'contratto');
  // codice diverso ma stesso CF + MOBILE
  const byCf = outcomeOf([row({ CODICE_CONTRATTO: 'ALTRO' })], item());
  assert.equal(byCf?.state, 'pagato');
  assert.equal(byCf.matchBy, 'cf');
  // stesso CF ma TIPO_FONIA FISSO: non aggancia un item mobile
  assert.equal(outcomeOf([row({ CODICE_CONTRATTO: 'ALTRO', TIPO_FONIA: 'FISSO' })], item()), null);
  // fisso aggancia FISSO; assicurazioni e protetti agganciano ASSICURAZIONI
  assert.equal(outcomeOf([row({ CODICE_CONTRATTO: 'ALTRO', TIPO_FONIA: 'FISSO' })], item({ driver: 'fisso', codiceContratto: null }))?.state, 'pagato');
  assert.equal(outcomeOf([row({ CODICE_CONTRATTO: 'ALTRO', TIPO_FONIA: 'ASSICURAZIONI' })], item({ driver: 'assicurazioni', codiceContratto: null }))?.state, 'pagato');
  assert.equal(outcomeOf([row({ CODICE_CONTRATTO: 'ALTRO', TIPO_FONIA: 'ASSICURAZIONI' })], item({ driver: 'protetti', codiceContratto: null }))?.state, 'pagato');
  // telefono: solo per codice contratto, niente fallback CF
  assert.equal(outcomeOf([row({ CODICE_CONTRATTO: 'ALTRO' })], item({ driver: 'telefono', codiceContratto: 'TEL-1' })), null);
  // P.IVA come chiave alternativa (clienti azienda)
  const byPiva = outcomeOf([row({ CODICE_CONTRATTO: 'ALTRO', FISCAL_CODE: '', P_IVA_CLIENTE: '01234567890' })], item({ cf: null, piva: '01234567890' }));
  assert.equal(byPiva?.state, 'pagato');
});

test('energia: match per POD/PDR (codice contratto DRMS ≠ BiSuite), fallback CF + ENERGIA', () => {
  const en = (over) => row({ TIPO_FONIA: 'ENERGIA', TIPO_TRANSAZIONE: 'W3 Energy', DESCRIZIONE_EVENTO: 'Contrat Attiv Luce e Gas_New', CODICE_CONTRATTO: 'DRMS-EN-1', ...over });
  const luce = item({ id: 'luce', driver: 'energia', codiceContratto: 'BIS-77', pod: 'IT001E00000001', pdr: null });
  const gas = item({ id: 'gas', driver: 'energia', codiceContratto: 'BIS-77', pod: null, pdr: '00881234567890' });
  const rows = [
    en({ POD_PDR: 'IT001E00000001' }),
    en({ POD_PDR: '00881234567890', IMPORTO: '0', IMPORTO_NUM: 0, CAUSALE_STORNO: 'DINIEGO' }),
  ];
  const r = computeDrmsOutcomes(rows, [luce, gas]);
  // stesso CODICE_CONTRATTO DRMS per luce+gas: le due righe si sommano sul
  // contratto (5 + 0 nella stessa competenza) ⇒ pagato per entrambe le
  // utenze agganciate a quel contratto.
  assert.equal(r.outcomes.get('luce')?.state, 'pagato');
  assert.equal(r.outcomes.get('luce').matchBy, 'pod_pdr');
  assert.equal(r.outcomes.get('gas')?.state, 'pagato');
  // POD sconosciuto ⇒ fallback CF + ENERGIA
  const cfOnly = outcomeOf(rows, item({ driver: 'energia', codiceContratto: 'BIS-99', pod: 'IT001E99999999' }));
  assert.equal(cfOnly?.state, 'pagato');
  assert.equal(cfOnly.matchBy, 'cf');
  // CF diverso e POD sconosciuto ⇒ nessun esito
  assert.equal(outcomeOf(rows, item({ driver: 'energia', cf: 'XXXXXX00X00X000X', codiceContratto: 'BIS-99', pod: 'IT001E99999999' })), null);
  // POD_PDR valorizzato su righe NON energia (nel DRMS reale contiene altri
  // numeri) non deve creare match per POD.
  assert.equal(outcomeOf([row({ POD_PDR: 'IT001E00000001', TIPO_FONIA: 'MOBILE' })],
    item({ driver: 'energia', cf: 'ALTRO', codiceContratto: 'BIS-1', pod: 'IT001E00000001' })), null);
});

test('CF ripetuto su più contratti: basta UN pagato; esiti diversi ⇒ ambiguo', () => {
  const rows = [
    row({ CODICE_CONTRATTO: 'A', IMPORTO: '0', IMPORTO_NUM: 0, CAUSALE_STORNO: 'DINIEGO' }),
    row({ CODICE_CONTRATTO: 'B' }),
    row({ CODICE_CONTRATTO: 'C', IMPORTO: '-5', IMPORTO_NUM: -5, CAUSALE_STORNO: 'PDA' }),
  ];
  const r = computeDrmsOutcomes(rows, [item({ codiceContratto: null })]);
  const out = r.outcomes.get('it1');
  assert.equal(out.state, 'pagato');
  assert.equal(out.ambiguous, true);
  assert.deepEqual([...out.contratti].sort(), ['A', 'B', 'C']);
  assert.equal(r.summary.ambiguous, 1);
  assert.equal(r.summary.byState.pagato, 1);
  // senza pagato: riaccreditato > stornato > annullato
  const r2 = computeDrmsOutcomes([rows[0], rows[2]], [item({ codiceContratto: null })]);
  assert.equal(r2.outcomes.get('it1').state, 'stornato');
});

// ===========================================================================
// Finestra T0..T+5
// ===========================================================================
test(`finestra: competenze fuori [mese inserimento, +${DRMS_WINDOW_MONTHS}] ignorate; senza data inserimento tutto conta`, () => {
  const it = item({ dataInserimento: '2026-07-20T00:00:00.000Z' }); // SIM di luglio 2026
  assert.equal(outcomeOf([row({ COMPETENZA: '2026-12' })], it)?.state, 'pagato', 'dicembre = T+5 incluso');
  assert.equal(outcomeOf([row({ COMPETENZA: '2027-01' })], it), null, 'gennaio 2027 = T+6 escluso');
  assert.equal(outcomeOf([row({ COMPETENZA: '2026-06' })], it), null, 'competenza precedente all\'inserimento esclusa');
  assert.equal(outcomeOf([row({ COMPETENZA: '2027-01' })], item({ dataInserimento: null }))?.state, 'pagato');
});

// ===========================================================================
// Applicazione allo stato economico (manuale vince, incongruenza)
// ===========================================================================
test('applyOutcomeToState: stato manuale vince e segnala incongruenza; automatico segue il DRMS', () => {
  const pag = { state: 'pagato' };
  assert.deepEqual(applyOutcomeToState({ economicState: null, economicStateManual: false }, pag), { economicState: 'pagato', mismatch: false });
  assert.deepEqual(applyOutcomeToState({ economicState: 'stornato', economicStateManual: true }, pag), { economicState: 'stornato', mismatch: true });
  assert.deepEqual(applyOutcomeToState({ economicState: 'pagato', economicStateManual: true }, pag), { economicState: 'pagato', mismatch: false });
  assert.deepEqual(applyOutcomeToState({ economicState: 'pagato', economicStateManual: true }, null), { economicState: 'pagato', mismatch: false });
  // esito DRMS sparito: si azzera solo se lo stato veniva dal DRMS
  assert.deepEqual(applyOutcomeToState({ economicState: 'pagato', economicStateManual: false, drmsOutcomeState: 'pagato' }, null), { economicState: null, mismatch: false });
  assert.deepEqual(applyOutcomeToState({ economicState: 'annullato', economicStateManual: false, drmsOutcomeState: null }, null), { economicState: 'annullato', mismatch: false },
    '"annullato" da BiSuite preservato');
});

test('isCjItemActive: KO operativo o annullato/stornato economico ⇒ non attivo; il resto sì', () => {
  assert.equal(isCjItemActive({ state: 'inserito', economicState: null }), true);
  assert.equal(isCjItemActive({ state: 'attivato', economicState: 'pagato' }), true);
  assert.equal(isCjItemActive({ state: 'inserito', economicState: 'riaccreditato' }), true);
  assert.equal(isCjItemActive({ state: 'ko', economicState: 'pagato' }), false);
  assert.equal(isCjItemActive({ state: 'attivato', economicState: 'annullato' }), false);
  assert.equal(isCjItemActive({ state: 'attivato', economicState: 'stornato' }), false);
  // valori legacy nel campo state (righe non migrate / fixture)
  assert.equal(isCjItemActive({ state: 'stornato' }), false);
  assert.equal(isCjItemActive({ state: 'pagato' }), true);
});

// ===========================================================================
// Upload "legacy" senza campi di esito
// ===========================================================================
test('upload legacy: righe senza chiavi FISCAL_CODE/POD_PDR/CAUSALE_STORNO ⇒ elencati nel riepilogo, mai conteggiati in silenzio', () => {
  const { detectLegacyDrmsUploads, drmsRowHasOutcomeFields } = drmsMod;
  // Riga come la salvava il vecchio parser (~20 colonne, niente chiavi di esito).
  const legacyRow = (over = {}) => {
    const r = row({ __UPLOAD_ID: 'up-old', TIPO_FONIA: 'ENERGIA', CODICE_CONTRATTO: 'DRMS-EN-OLD', ...over });
    delete r.FISCAL_CODE; delete r.P_IVA_CLIENTE; delete r.POD_PDR; delete r.CAUSALE_STORNO; delete r.DATA_EVENTO; delete r.TIPO_TRANSAZIONE;
    return r;
  };
  assert.equal(drmsRowHasOutcomeFields(legacyRow()), false);
  assert.equal(drmsRowHasOutcomeFields(row({ FISCAL_CODE: '' })), true, 'chiave presente ma vuota = parser nuovo');

  const rows = [
    legacyRow(), legacyRow(), legacyRow({ NATURA: 'GARE' }),
    row({ __UPLOAD_ID: 'up-new', TIPO_FONIA: 'ENERGIA', CODICE_CONTRATTO: 'DRMS-EN-1', POD_PDR: 'IT001E00000001', FISCAL_CODE: '' }),
    row({ __UPLOAD_ID: 'up-new', CODICE_CONTRATTO: 'C-MOB-1' }),
  ];
  assert.deepEqual(detectLegacyDrmsUploads(rows), [{ uploadId: 'up-old', rows: 3 }]);
  assert.deepEqual(detectLegacyDrmsUploads([]), []);

  const energia = item({ id: 'en', driver: 'energia', codiceContratto: 'WT-0001210742', pod: 'IT001E00000001' });
  const energiaOld = item({ id: 'en-old', driver: 'energia', cf: 'CNNFRZ70H24H501L', codiceContratto: 'WT-0001210743', pod: 'IT002E5386834A' });
  const r = computeDrmsOutcomes(rows, [item(), energia, energiaOld]);
  assert.equal(r.summary.matched, 2);
  assert.equal(r.outcomes.get('en')?.matchBy, 'pod_pdr');
  assert.equal(r.outcomes.get('en-old'), null, 'il POD è solo nell\'upload legacy: nessun aggancio possibile');
  assert.deepEqual(r.summary.legacyUploads, [{ uploadId: 'up-old', rows: 3 }]);
  assert.equal(r.summary.legacyRows, 3);
  assert.deepEqual(r.summary.notFoundByDriver, { energia: 1 });
  // Senza upload legacy il riepilogo è pulito.
  const clean = computeDrmsOutcomes(rows.slice(3), [item()]);
  assert.deepEqual(clean.summary.legacyUploads, []);
  assert.equal(clean.summary.legacyRows, 0);
  assert.deepEqual(clean.summary.notFoundByDriver, {});
});
