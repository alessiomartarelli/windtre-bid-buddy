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
