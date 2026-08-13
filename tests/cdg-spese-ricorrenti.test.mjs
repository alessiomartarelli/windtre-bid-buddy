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

// Spese ricorrenti dal dialogo "Nuova spesa" (POST /api/cdg/spese).
//
// La generazione delle occorrenze è stata estratta nell'helper condiviso
// generaOccorrenzeRicorrenti (server/cdgRoutes.ts), usato anche dall'import
// Excel (coperto da tests/cdg-import-spese.test.mjs). Qui copriamo il
// percorso manuale:
//   (a) mensile: master + cloni, clamp del giorno (31 → 28/30), offset
//       cassa 0–3, campi ricorrenza persistiti su TUTTE le occorrenze;
//   (b) annuale: una occorrenza per anno;
//   (c) una tantum: nessun campo ricorrenza persistito anche se inviato;
//   (d) errori: date mancanti, fine < inizio, offset fuori range (zod).

const api = (session, method, path, body) =>
  jsonReq(`${BASE}${path}`, {
    method,
    headers: { Cookie: session.cookieHeader },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

test('POST /api/cdg/spese ricorrente: master+cloni, clamp giorno, offset cassa, errori', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cdg_spese_ric_test', fullName: 'Cdg Spese Ric Test' });
  try {
    await setRole(pool, session.profileId, 'admin');

    const rs = uniq('RS Ric');
    const createRs = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: rs });
    assert.equal(createRs.status, 201, `create RS: ${JSON.stringify(createRs.body)}`);

    const baseSpesa = {
      ragioneSociale: rs,
      descrizione: 'Affitto mensile',
      imponibile: '1000',
      aliquotaIva: '22',
      dataPagamento: '2027-01-31',
      meseCompetenza: '2026-12',
      metodoPagamento: 'RID/SDD',
    };

    // (a) Mensile con clamp e offset cassa 1: competenza 12/2026 → 03/2027
    // inclusa, giorno pagamento 31, offset 1 mese => 4 occorrenze.
    const mensile = await api(session, 'POST', '/api/cdg/spese', {
      ...baseSpesa,
      ricorrente: true,
      periodicita: 'mensile',
      cashFlowOffsetMesi: 1,
      dataInizioRicorrenza: '2026-12-31',
      dataFineRicorrenza: '2027-03-31',
    });
    assert.equal(mensile.status, 201, `create mensile: ${JSON.stringify(mensile.body)}`);
    assert.equal(mensile.body.ricorrenzaGenerati, 3, 'master + 3 cloni');
    // La master deve usare la PRIMA occorrenza.
    assert.equal(mensile.body.dataPagamento, '2027-01-31');
    assert.equal(mensile.body.meseCompetenza, '2026-12');

    const rows = await pool.query(
      `SELECT id, data_pagamento::text AS dp, mese_competenza AS mc, ricorrente, periodicita,
              cash_flow_offset_mesi AS off,
              data_inizio_ricorrenza::text AS di, data_fine_ricorrenza::text AS df,
              imponibile, iva, importo
         FROM cdg_spese WHERE organization_id = $1 AND descrizione = 'Affitto mensile'
        ORDER BY mese_competenza`,
      [session.orgId],
    );
    assert.deepEqual(rows.rows.map(r => [r.dp, r.mc]), [
      ['2027-01-31', '2026-12'],
      ['2027-02-28', '2027-01'], // clamp 31 → 28
      ['2027-03-31', '2027-02'],
      ['2027-04-30', '2027-03'], // clamp 31 → 30
    ], 'pagamenti = competenza + offset 1 mese, giorno clampato');
    for (const r of rows.rows) {
      assert.equal(r.ricorrente, true, 'flag ricorrente su master e cloni');
      assert.equal(r.periodicita, 'mensile');
      assert.equal(r.off, 1, 'offset cassa persistito');
      assert.equal(r.di, '2026-12-31', 'data inizio persistita');
      assert.equal(r.df, '2027-03-31', 'data fine persistita');
      // IVA/totale calcolati server-side, identici su ogni occorrenza.
      assert.equal(r.imponibile, '1000.00');
      assert.equal(r.iva, '220.00');
      assert.equal(r.importo, '1220.00');
    }
    // Le occorrenze sono righe indipendenti (id distinti).
    assert.equal(new Set(rows.rows.map(r => r.id)).size, 4);
    // La riga restituita dal POST è la master (prima competenza).
    assert.equal(mensile.body.id, rows.rows[0].id, 'response = master');

    // (b) Annuale: 2026 → 2028 = 3 occorrenze, offset 0, giorno 13 (nessun clamp).
    const annuale = await api(session, 'POST', '/api/cdg/spese', {
      ...baseSpesa,
      descrizione: 'Canone annuale',
      dataPagamento: '2026-08-13',
      meseCompetenza: '2026-08',
      ricorrente: true,
      periodicita: 'annuale',
      cashFlowOffsetMesi: 0,
      dataInizioRicorrenza: '2026-08-13',
      dataFineRicorrenza: '2028-08-31',
    });
    assert.equal(annuale.status, 201, `create annuale: ${JSON.stringify(annuale.body)}`);
    assert.equal(annuale.body.ricorrenzaGenerati, 2, 'annuale 2026→2028 = master + 2 cloni');
    const ann = await pool.query(
      `SELECT data_pagamento::text AS dp, mese_competenza AS mc, periodicita
         FROM cdg_spese WHERE organization_id = $1 AND descrizione = 'Canone annuale'
        ORDER BY mese_competenza`,
      [session.orgId],
    );
    assert.deepEqual(ann.rows.map(r => [r.dp, r.mc, r.periodicita]), [
      ['2026-08-13', '2026-08', 'annuale'],
      ['2027-08-13', '2027-08', 'annuale'],
      ['2028-08-13', '2028-08', 'annuale'],
    ]);

    // Periodicita omessa con ricorrente=true => default mensile.
    const defPer = await api(session, 'POST', '/api/cdg/spese', {
      ...baseSpesa,
      descrizione: 'Default mensile',
      dataPagamento: '2026-09-15',
      meseCompetenza: '2026-09',
      ricorrente: true,
      dataInizioRicorrenza: '2026-09-15',
      dataFineRicorrenza: '2026-10-31',
    });
    assert.equal(defPer.status, 201, `default periodicita: ${JSON.stringify(defPer.body)}`);
    assert.equal(defPer.body.periodicita, 'mensile', 'periodicita omessa => mensile');
    assert.equal(defPer.body.ricorrenzaGenerati, 1, '09 e 10/2026 = 2 occorrenze');

    // (c) Una tantum: eventuali campi ricorrenza inviati NON vanno persistiti.
    const unaTantum = await api(session, 'POST', '/api/cdg/spese', {
      ...baseSpesa,
      descrizione: 'Spot',
      dataPagamento: '2026-08-13',
      meseCompetenza: '2026-08',
      ricorrente: false,
      periodicita: 'mensile',
      dataInizioRicorrenza: '2026-08-01',
      dataFineRicorrenza: '2026-12-31',
      cashFlowOffsetMesi: 2,
    });
    assert.equal(unaTantum.status, 201, `una tantum: ${JSON.stringify(unaTantum.body)}`);
    assert.equal(unaTantum.body.ricorrenzaGenerati, 0);
    const spot = await pool.query(
      `SELECT ricorrente, periodicita, data_inizio_ricorrenza AS di, data_fine_ricorrenza AS df,
              cash_flow_offset_mesi AS off, count(*) OVER () ::int AS n
         FROM cdg_spese WHERE organization_id = $1 AND descrizione = 'Spot'`,
      [session.orgId],
    );
    assert.equal(spot.rows.length, 1, 'una tantum = 1 sola riga');
    assert.equal(spot.rows[0].ricorrente, false);
    assert.equal(spot.rows[0].periodicita, null, 'periodicita azzerata su una tantum');
    assert.equal(spot.rows[0].di, null);
    assert.equal(spot.rows[0].df, null);
    assert.equal(spot.rows[0].off, 2, 'offset cassa comunque persistito (clampato 0..3)');

    // (d) Errori: nessuna riga deve essere scritta.
    const prima = await pool.query(
      `SELECT count(*)::int AS n FROM cdg_spese WHERE organization_id = $1`, [session.orgId]);

    const noDates = await api(session, 'POST', '/api/cdg/spese', {
      ...baseSpesa, descrizione: 'Err no dates', ricorrente: true, periodicita: 'mensile',
    });
    assert.equal(noDates.status, 400, `date mancanti => 400: ${JSON.stringify(noDates.body)}`);

    const soloInizio = await api(session, 'POST', '/api/cdg/spese', {
      ...baseSpesa, descrizione: 'Err solo inizio', ricorrente: true,
      dataInizioRicorrenza: '2026-12-01',
    });
    assert.equal(soloInizio.status, 400, 'solo data inizio => 400');

    const fineMinore = await api(session, 'POST', '/api/cdg/spese', {
      ...baseSpesa, descrizione: 'Err fine < inizio', ricorrente: true,
      dataInizioRicorrenza: '2027-03-01', dataFineRicorrenza: '2026-12-31',
    });
    assert.equal(fineMinore.status, 400, 'fine < inizio => 400');
    assert.match(String(fineMinore.body?.error || ''), /fine/i);

    // Offset fuori range: rifiutato dallo schema zod (min 0 max 3).
    const offAlto = await api(session, 'POST', '/api/cdg/spese', {
      ...baseSpesa, descrizione: 'Err offset', ricorrente: true, cashFlowOffsetMesi: 4,
      dataInizioRicorrenza: '2026-12-31', dataFineRicorrenza: '2027-03-31',
    });
    assert.equal(offAlto.status, 400, 'offset 4 => 400');

    const dopo = await pool.query(
      `SELECT count(*)::int AS n FROM cdg_spese WHERE organization_id = $1`, [session.orgId]);
    assert.equal(dopo.rows[0].n, prima.rows[0].n, 'i casi di errore non devono scrivere spese');
  } finally {
    await pool.query(`DELETE FROM cdg_spese WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await pool.query(`DELETE FROM cdg_ragioni_sociali WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
