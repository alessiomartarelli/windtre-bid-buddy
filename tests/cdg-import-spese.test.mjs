import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  uniq,
  jsonReq,
  signup,
  setRole,
  cleanupOrg,
  newPool,
} from './helpers/uiTest.mjs';

// Import spese da Excel: preview + confirm.
//
// Verifica che:
//   (a) preview non scriva nulla e classifichi righe ok / errore con azioni;
//   (b) confirm crei categorie/fornitori/PDV mancanti e riusi gli esistenti
//       (PDV riconosciuto per codice nella RS, categoria per nome CI);
//   (c) le righe invalide (RS inesistente / dati mancanti) siano scartate
//       senza bloccare quelle valide;
//   (d) IVA e totale seguano le regole dell'inserimento manuale.

const api = (session, method, path, body) =>
  jsonReq(`${BASE}${path}`, {
    method,
    headers: { Cookie: session.cookieHeader },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

test('import spese Excel: preview, anagrafiche automatiche, righe invalide scartate', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cdg_import_spese_test', fullName: 'Cdg Import Spese Test' });
  try {
    await setRole(pool, session.profileId, 'admin');

    // Seed: RS manuale + categoria esistente + PDV manuale esistente.
    const rs = uniq('RS Import');
    const createRs = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: rs });
    assert.equal(createRs.status, 201, `create RS: ${JSON.stringify(createRs.body)}`);

    const catEsistente = uniq('Utenze');
    const createCat = await api(session, 'POST', '/api/cdg/categorie', { nome: catEsistente, ragioniSociali: [rs] });
    assert.equal(createCat.status, 201, `create categoria: ${JSON.stringify(createCat.body)}`);
    const catId = createCat.body.id;

    const pdvEsistente = uniq('PV');
    const createPdv = await api(session, 'POST', '/api/cdg/pdv-manuali', { ragioneSociale: rs, codice: pdvEsistente, nome: 'PDV Esistente' });
    assert.equal(createPdv.status, 201, `create pdv: ${JSON.stringify(createPdv.body)}`);

    const catNuova = uniq('Pulizie');
    const fornNuovo = uniq('Fornitore Nuovo');
    const pdvNuovo = uniq('PVNEW');

    const rows = [
      { // riusa categoria (case-insensitive) + PDV esistente per codice, crea fornitore
        ragioneSociale: rs, pdvCodice: pdvEsistente, pdvNome: '',
        categoria: catEsistente.toUpperCase(), fornitore: fornNuovo,
        descrizione: 'Bolletta luce', imponibile: '1.100,00', aliquotaIva: '22',
        dataPagamento: '13/08/2026', meseCompetenza: '07/2026', metodoPagamento: 'Bonifico', note: '',
      },
      { // crea categoria + PDV nuovo; aliquota default 22; competenza derivata
        ragioneSociale: rs, pdvCodice: pdvNuovo, pdvNome: 'PDV Creato',
        categoria: catNuova, fornitore: '',
        descrizione: 'Pulizie agosto', imponibile: '50', aliquotaIva: '',
        dataPagamento: '2026-08-01', meseCompetenza: '', metodoPagamento: '', note: 'nota',
      },
      { // RS inesistente => scartata
        ragioneSociale: 'RS Inesistente XYZ', pdvCodice: '', pdvNome: '',
        categoria: '', fornitore: '', descrizione: 'Spesa orfana',
        imponibile: '10', aliquotaIva: '22', dataPagamento: '13/08/2026',
        meseCompetenza: '', metodoPagamento: '', note: '',
      },
      { // dati mancanti => scartata
        ragioneSociale: rs, pdvCodice: '', pdvNome: '',
        categoria: '', fornitore: '', descrizione: '',
        imponibile: 'abc', aliquotaIva: '22', dataPagamento: '',
        meseCompetenza: '', metodoPagamento: '', note: '',
      },
    ];

    // (a) Preview: 2 valide, 2 scartate, nessuna scrittura.
    const preview = await api(session, 'POST', '/api/cdg/spese/import/preview', { rows });
    assert.equal(preview.status, 200, `preview: ${JSON.stringify(preview.body)}`);
    assert.equal(preview.body.valide, 2);
    assert.equal(preview.body.scartate, 2);
    assert.equal(preview.body.righe[0].esito, 'ok');
    assert.ok(preview.body.righe[0].azioni.some(a => a.includes(fornNuovo)), 'preview deve annunciare la creazione del fornitore');
    assert.ok(preview.body.righe[1].azioni.some(a => a.includes(pdvNuovo)), 'preview deve annunciare la creazione del PDV');
    assert.equal(preview.body.righe[2].esito, 'errore');
    assert.equal(preview.body.righe[3].esito, 'errore');
    const speseDopoPreview = await pool.query(`SELECT count(*)::int AS n FROM cdg_spese WHERE organization_id = $1`, [session.orgId]);
    assert.equal(speseDopoPreview.rows[0].n, 0, 'preview non deve scrivere spese');

    // (b+c) Confirm.
    const confirm = await api(session, 'POST', '/api/cdg/spese/import/confirm', { rows });
    assert.equal(confirm.status, 200, `confirm: ${JSON.stringify(confirm.body)}`);
    assert.equal(confirm.body.importate, 2);
    assert.equal(confirm.body.scartate, 2);
    assert.equal(confirm.body.categorieCreate, 1);
    assert.equal(confirm.body.fornitoriCreati, 1);
    assert.equal(confirm.body.pdvCreati, 1);

    const spese = await pool.query(
      `SELECT descrizione, categoria_id, fornitore_id, pdv_codice, imponibile, aliquota_iva, iva, importo, data_pagamento::text AS dp, mese_competenza
         FROM cdg_spese WHERE organization_id = $1 ORDER BY descrizione`,
      [session.orgId],
    );
    assert.equal(spese.rows.length, 2, 'devono esserci solo le 2 spese valide');
    const bolletta = spese.rows.find(r => r.descrizione === 'Bolletta luce');
    const pulizie = spese.rows.find(r => r.descrizione === 'Pulizie agosto');

    // (d) IVA/totale come inserimento manuale + matching esistenti.
    assert.equal(bolletta.categoria_id, catId, 'categoria esistente riusata (match case-insensitive)');
    assert.equal(bolletta.pdv_codice, pdvEsistente, 'PDV esistente riconosciuto per codice');
    assert.equal(bolletta.imponibile, '1100.00', 'formato italiano "1.100,00" parsato correttamente');
    assert.equal(bolletta.iva, '242.00');
    assert.equal(bolletta.importo, '1342.00');
    assert.equal(bolletta.dp, '2026-08-13');
    assert.equal(bolletta.mese_competenza, '2026-07');
    assert.ok(bolletta.fornitore_id, 'fornitore creato e collegato');

    assert.equal(pulizie.aliquota_iva, '22.00', 'aliquota vuota => default 22');
    assert.equal(pulizie.importo, '61.00');
    assert.equal(pulizie.mese_competenza, '2026-08', 'competenza derivata dalla data pagamento');
    assert.equal(pulizie.pdv_codice, pdvNuovo);

    const pdvCreato = await pool.query(
      `SELECT nome, ragione_sociale FROM cdg_pdv_manuali WHERE organization_id = $1 AND codice = $2`,
      [session.orgId, pdvNuovo],
    );
    assert.equal(pdvCreato.rows[0]?.nome, 'PDV Creato');
    assert.equal(pdvCreato.rows[0]?.ragione_sociale, rs);

    const catCreata = await pool.query(
      `SELECT ragioni_sociali FROM cdg_categorie WHERE organization_id = $1 AND nome = $2`,
      [session.orgId, catNuova],
    );
    assert.deepEqual(catCreata.rows[0]?.ragioni_sociali, [rs], 'categoria creata e associata alla RS');

    // Re-import dello stesso file => nessun doppione.
    const again = await api(session, 'POST', '/api/cdg/spese/import/confirm', { rows });
    assert.equal(again.status, 200, `confirm ripetuto: ${JSON.stringify(again.body)}`);
    assert.equal(again.body.importate, 0, 'reimport identico non deve creare spese');
    assert.equal(again.body.duplicati, 2, 'le 2 righe valide devono risultare duplicate');
    const dopoRetry = await pool.query(`SELECT count(*)::int AS n FROM cdg_spese WHERE organization_id = $1`, [session.orgId]);
    assert.equal(dopoRetry.rows[0].n, 2, 'il totale spese non deve cambiare dopo il retry');

    // Due spese distinte con stessa RS/descrizione/importo/data ma PDV
    // diverso NON sono duplicati: entrambe vanno importate.
    const gemella = { ...rows[0], pdvCodice: pdvNuovo, pdvNome: '' };
    const twins = await api(session, 'POST', '/api/cdg/spese/import/confirm', { rows: [gemella] });
    assert.equal(twins.status, 200, `confirm gemella: ${JSON.stringify(twins.body)}`);
    assert.equal(twins.body.importate, 1, 'spesa uguale ma su PDV diverso non è un duplicato');
    assert.equal(twins.body.duplicati, 0);
    const dopoTwins = await pool.query(`SELECT count(*)::int AS n FROM cdg_spese WHERE organization_id = $1`, [session.orgId]);
    assert.equal(dopoTwins.rows[0].n, 3);
    // ...ma il retry esatto della gemella resta deduplicato.
    const twinsRetry = await api(session, 'POST', '/api/cdg/spese/import/confirm', { rows: [gemella] });
    assert.equal(twinsRetry.body.duplicati, 1, 'retry esatto della gemella deduplicato');
    assert.equal(twinsRetry.body.importate, 0);

    // Importi malformati => riga scartata (no "100abc" accettato come 100).
    const badAmount = await api(session, 'POST', '/api/cdg/spese/import/preview', {
      rows: [{ ...rows[0], descrizione: 'Junk', imponibile: '100abc' }],
    });
    assert.equal(badAmount.status, 200);
    assert.equal(badAmount.body.righe[0].esito, 'errore', 'imponibile "100abc" deve essere rifiutato');

    // Solo righe invalide => 400, nessuna scrittura.
    const allBad = await api(session, 'POST', '/api/cdg/spese/import/confirm', { rows: [rows[2]] });
    assert.equal(allBad.status, 400, `confirm con sole righe invalide deve dare 400, got ${allBad.status}`);

    // === Ricorrenza ===
    // Mensile con clamp del giorno (31 → 28 a febbraio) e offset cassa:
    // competenza parte da 12/2026, pagamento 31/01/2027 => offset 1 mese,
    // fino a 03/2027 => 4 occorrenze (12/26, 01/27, 02/27, 03/27).
    const ricRow = {
      ragioneSociale: rs, pdvCodice: pdvEsistente, pdvNome: '',
      categoria: '', fornitore: '',
      descrizione: 'Affitto ricorrente', imponibile: '1000', aliquotaIva: '22',
      dataPagamento: '31/01/2027', meseCompetenza: '12/2026',
      metodoPagamento: 'RID/SDD', note: '',
      ricorrente: 'Mensile', ricorrenzaFine: '03/2027',
    };
    const ricPrev = await api(session, 'POST', '/api/cdg/spese/import/preview', { rows: [ricRow] });
    assert.equal(ricPrev.status, 200, `preview ricorrente: ${JSON.stringify(ricPrev.body)}`);
    assert.equal(ricPrev.body.righe[0].esito, 'ok');
    assert.equal(ricPrev.body.righe[0].dati.occorrenze, 4, 'preview deve contare 4 occorrenze');
    assert.equal(ricPrev.body.righe[0].dati.periodicita, 'mensile');
    assert.ok(ricPrev.body.righe[0].azioni.some(a => a.includes('4 occorrenze')), 'azione deve annunciare le occorrenze');

    const ricConf = await api(session, 'POST', '/api/cdg/spese/import/confirm', { rows: [ricRow] });
    assert.equal(ricConf.status, 200, `confirm ricorrente: ${JSON.stringify(ricConf.body)}`);
    assert.equal(ricConf.body.importate, 4, 'una riga ricorrente genera 4 spese');

    const ricSpese = await pool.query(
      `SELECT data_pagamento::text AS dp, mese_competenza, ricorrente, periodicita,
              data_inizio_ricorrenza::text AS di, data_fine_ricorrenza::text AS df,
              cash_flow_offset_mesi AS off
         FROM cdg_spese WHERE organization_id = $1 AND descrizione = 'Affitto ricorrente'
        ORDER BY mese_competenza`,
      [session.orgId],
    );
    assert.deepEqual(ricSpese.rows.map(r => [r.dp, r.mese_competenza]), [
      ['2027-01-31', '2026-12'],
      ['2027-02-28', '2027-01'], // clamp 31 → 28
      ['2027-03-31', '2027-02'],
      ['2027-04-30', '2027-03'], // clamp 31 → 30
    ], 'pagamenti = competenza + 1 mese di offset, giorno clampato');
    for (const r of ricSpese.rows) {
      assert.equal(r.ricorrente, true);
      assert.equal(r.periodicita, 'mensile');
      // Stesso modello del dialogo manuale: inizio = competenza di partenza
      // (giorno = giorno pagamento), fine = ultimo giorno di "Fino a",
      // offset cassa persistito (competenza 12/2026 → pagamento 01/2027 = 1).
      assert.equal(r.di, '2026-12-31', 'data inizio ricorrenza ancorata alla competenza di partenza');
      assert.equal(r.df, '2027-03-31');
      assert.equal(r.off, 1, 'offset cassa derivato e persistito');
    }


    // Retry identico => tutte le occorrenze deduplicate.
    const ricRetry = await api(session, 'POST', '/api/cdg/spese/import/confirm', { rows: [ricRow] });
    assert.equal(ricRetry.body.importate, 0, 'reimport ricorrente non deve duplicare');
    assert.equal(ricRetry.body.duplicati, 4);

    // Edit/re-save di un'occorrenza importata: i campi ricorrenza non devono
    // essere azzerati da un PUT che non li tocca.
    const ricId = await pool.query(
      `SELECT id FROM cdg_spese WHERE organization_id = $1 AND descrizione = 'Affitto ricorrente' ORDER BY mese_competenza LIMIT 1`,
      [session.orgId],
    );
    const putRic = await api(session, 'PUT', `/api/cdg/spese/${ricId.rows[0].id}`, { note: 'aggiornata' });
    assert.equal(putRic.status, 200, `PUT spesa ricorrente importata: ${JSON.stringify(putRic.body)}`);
    const afterPut = await pool.query(
      `SELECT ricorrente, periodicita, cash_flow_offset_mesi AS off, data_inizio_ricorrenza::text AS di
         FROM cdg_spese WHERE id = $1`, [ricId.rows[0].id],
    );
    assert.equal(afterPut.rows[0].ricorrente, true);
    assert.equal(afterPut.rows[0].periodicita, 'mensile');
    assert.equal(afterPut.rows[0].off, 1);
    assert.equal(afterPut.rows[0].di, '2026-12-31');

    // Annuale: 13/08/2026 → fino a 08/2028 = 3 occorrenze.
    const annRow = {
      ...ricRow, descrizione: 'Canone annuale', dataPagamento: '13/08/2026',
      meseCompetenza: '', ricorrente: 'annuale', ricorrenzaFine: '08/2028',
    };
    const annPrev = await api(session, 'POST', '/api/cdg/spese/import/preview', { rows: [annRow] });
    assert.equal(annPrev.body.righe[0].esito, 'ok');
    assert.equal(annPrev.body.righe[0].dati.occorrenze, 3, 'annuale 2026→2028 = 3 occorrenze');

    // Errori ricorrenza: valore non valido, "Fino a" mancante, "Fino a" nel passato.
    const badRic = await api(session, 'POST', '/api/cdg/spese/import/preview', {
      rows: [
        { ...ricRow, ricorrente: 'settimanale' },
        { ...ricRow, ricorrenzaFine: '' },
        { ...ricRow, ricorrenzaFine: '11/2026' },
        { ...ricRow, ricorrente: '', ricorrenzaFine: '03/2027' },
        // offset cassa fuori range: pagamento 4 mesi dopo la competenza
        { ...ricRow, descrizione: 'Offset troppo grande', dataPagamento: '15/04/2027', meseCompetenza: '12/2026' },
        // offset negativo: pagamento prima della competenza
        { ...ricRow, descrizione: 'Offset negativo', dataPagamento: '15/11/2026', meseCompetenza: '12/2026' },
      ],
    });
    assert.equal(badRic.status, 200);
    for (const [i, why] of [[0, 'periodicità sconosciuta'], [1, 'Fino a mancante'], [2, 'Fino a nel passato'], [3, 'Fino a senza Ricorrente'], [4, 'offset > 3 mesi'], [5, 'offset negativo']]) {
      assert.equal(badRic.body.righe[i].esito, 'errore', `riga ${i} (${why}) deve essere scartata: ${JSON.stringify(badRic.body.righe[i])}`);
    }

    // Confirm con sole righe a offset invalido => 400, nessuna occorrenza scritta.
    const badOffConfirm = await api(session, 'POST', '/api/cdg/spese/import/confirm', {
      rows: [{ ...ricRow, descrizione: 'Offset troppo grande', dataPagamento: '15/04/2027', meseCompetenza: '12/2026' }],
    });
    assert.equal(badOffConfirm.status, 400, 'confirm con offset fuori range deve dare 400');
    const offRows = await pool.query(
      `SELECT count(*)::int AS n FROM cdg_spese WHERE organization_id = $1 AND descrizione = 'Offset troppo grande'`,
      [session.orgId],
    );
    assert.equal(offRows.rows[0].n, 0, 'nessuna occorrenza scritta per offset invalido');
  } finally {
    await pool.query(`DELETE FROM cdg_spese WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await pool.query(`DELETE FROM cdg_pdv_manuali WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await pool.query(`DELETE FROM cdg_categorie WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await pool.query(`DELETE FROM cdg_fornitori WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await pool.query(`DELETE FROM cdg_ragioni_sociali WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
