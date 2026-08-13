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

// Modifica di una spesa ricorrente per TUTTO il periodo (applicaATutte):
//   (a) creazione ricorrente assegna lo stesso ricorrenza_id a master+cloni;
//   (b) PUT con applicaATutte aggiorna i campi condivisi su tutte le occorrenze
//       senza toccare dataPagamento/meseCompetenza per-occorrenza (salvo offset);
//   (c) estendere dataFineRicorrenza crea le occorrenze mancanti;
//   (d) accorciarla elimina quelle fuori periodo;
//   (e) PUT senza applicaATutte resta per-riga;
//   (f) il backfill raggruppa le ricorrenze storiche senza ricorrenza_id.

const api = (session, method, path, body) =>
  jsonReq(`${BASE}${path}`, {
    method,
    headers: { Cookie: session.cookieHeader },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

test('spesa ricorrente: modifica applicata a tutto il periodo', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cdg_ric_edit_test', fullName: 'Cdg Ric Edit Test' });
  try {
    await setRole(pool, session.profileId, 'admin');

    const rs = uniq('RS RicEdit');
    const createRs = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: rs });
    assert.equal(createRs.status, 201, `create RS: ${JSON.stringify(createRs.body)}`);

    // (a) Ricorrente mensile 01/2027..04/2027 = 4 occorrenze.
    const crea = await api(session, 'POST', '/api/cdg/spese', {
      ragioneSociale: rs,
      descrizione: 'Affitto sede',
      imponibile: '1000.00',
      aliquotaIva: '22.00',
      dataPagamento: '2027-01-05',
      meseCompetenza: '2027-01',
      ricorrente: true,
      periodicita: 'mensile',
      cashFlowOffsetMesi: 0,
      dataInizioRicorrenza: '2027-01-05',
      dataFineRicorrenza: '2027-04-30',
    });
    assert.equal(crea.status, 201, `create: ${JSON.stringify(crea.body)}`);

    const rows0 = await pool.query(
      `SELECT id, mese_competenza, ricorrenza_id FROM cdg_spese
        WHERE organization_id = $1 AND descrizione = 'Affitto sede' ORDER BY mese_competenza`,
      [session.orgId],
    );
    assert.equal(rows0.rows.length, 4, '4 occorrenze create');
    const gid = rows0.rows[0].ricorrenza_id;
    assert.ok(gid, 'ricorrenza_id assegnato');
    assert.ok(rows0.rows.every(r => r.ricorrenza_id === gid), 'stesso ricorrenza_id su tutte');

    // (b) Modifica importo+descrizione+note su tutto il periodo.
    const put1 = await api(session, 'PUT', `/api/cdg/spese/${rows0.rows[1].id}`, {
      applicaATutte: true,
      descrizione: 'Affitto sede NUOVO',
      imponibile: '1200.00',
      aliquotaIva: '22.00',
      note: 'aggiornata per tutto il periodo',
    });
    assert.equal(put1.status, 200, `put tutte: ${JSON.stringify(put1.body)}`);
    assert.equal(put1.body.ricorrenzaAggiornate, 4);
    assert.equal(put1.body.ricorrenzaCreate, 0);
    assert.equal(put1.body.ricorrenzaEliminate, 0);

    const dopo1 = await pool.query(
      `SELECT descrizione, imponibile, importo, note, mese_competenza, data_pagamento::text AS dp
         FROM cdg_spese WHERE organization_id = $1 AND ricorrenza_id = $2 ORDER BY mese_competenza`,
      [session.orgId, gid],
    );
    assert.equal(dopo1.rows.length, 4);
    for (const r of dopo1.rows) {
      assert.equal(r.descrizione, 'Affitto sede NUOVO');
      assert.equal(r.imponibile, '1200.00');
      assert.equal(r.importo, '1464.00');
      assert.equal(r.note, 'aggiornata per tutto il periodo');
    }
    assert.deepEqual(dopo1.rows.map(r => [r.mese_competenza, r.dp]), [
      ['2027-01', '2027-01-05'],
      ['2027-02', '2027-02-05'],
      ['2027-03', '2027-03-05'],
      ['2027-04', '2027-04-05'],
    ], 'date per-occorrenza invariate');

    // (c) Estensione: fine 06/2027 => +2 occorrenze.
    const put2 = await api(session, 'PUT', `/api/cdg/spese/${rows0.rows[0].id}`, {
      applicaATutte: true,
      dataFineRicorrenza: '2027-06-30',
    });
    assert.equal(put2.status, 200, `estensione: ${JSON.stringify(put2.body)}`);
    assert.equal(put2.body.ricorrenzaCreate, 2);
    const dopo2 = await pool.query(
      `SELECT mese_competenza, descrizione, importo, data_fine_ricorrenza::text AS df
         FROM cdg_spese WHERE organization_id = $1 AND ricorrenza_id = $2 ORDER BY mese_competenza`,
      [session.orgId, gid],
    );
    assert.deepEqual(dopo2.rows.map(r => r.mese_competenza),
      ['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06']);
    for (const r of dopo2.rows) {
      assert.equal(r.descrizione, 'Affitto sede NUOVO', 'nuove occorrenze clonate dai dati aggiornati');
      assert.equal(r.importo, '1464.00');
      assert.equal(r.df, '2027-06-30', 'nuova fine su tutte le occorrenze');
    }

    // (d) Accorciamento: fine 02/2027 => restano 2 occorrenze.
    const put3 = await api(session, 'PUT', `/api/cdg/spese/${rows0.rows[0].id}`, {
      applicaATutte: true,
      dataFineRicorrenza: '2027-02-28',
    });
    assert.equal(put3.status, 200, `accorciamento: ${JSON.stringify(put3.body)}`);
    assert.equal(put3.body.ricorrenzaEliminate, 4);
    const dopo3 = await pool.query(
      `SELECT mese_competenza FROM cdg_spese WHERE organization_id = $1 AND ricorrenza_id = $2 ORDER BY mese_competenza`,
      [session.orgId, gid],
    );
    assert.deepEqual(dopo3.rows.map(r => r.mese_competenza), ['2027-01', '2027-02']);

    // (e) PUT senza applicaATutte: modifica una sola occorrenza.
    const soloId = dopo3.rows.length ? (await pool.query(
      `SELECT id FROM cdg_spese WHERE organization_id = $1 AND ricorrenza_id = $2 AND mese_competenza = '2027-01'`,
      [session.orgId, gid],
    )).rows[0].id : null;
    const put4 = await api(session, 'PUT', `/api/cdg/spese/${soloId}`, { note: 'solo questa' });
    assert.equal(put4.status, 200);
    const note = await pool.query(
      `SELECT mese_competenza, note FROM cdg_spese WHERE organization_id = $1 AND ricorrenza_id = $2 ORDER BY mese_competenza`,
      [session.orgId, gid],
    );
    assert.equal(note.rows[0].note, 'solo questa');
    assert.equal(note.rows[1].note, 'aggiornata per tutto il periodo', 'le altre occorrenze non cambiano');

    // (f) Backfill storico: simula ricorrenza pre-esistente senza ricorrenza_id
    // + due serie indipendenti IDENTICHE che NON devono essere fuse.
    await pool.query(
      `UPDATE cdg_spese SET ricorrenza_id = NULL WHERE organization_id = $1 AND ricorrenza_id = $2`,
      [session.orgId, gid],
    );
    // Seconda serie identica alla prima (stessi campi e stesso periodo):
    // duplica le righe residue senza ricorrenza_id.
    await pool.query(`
      INSERT INTO cdg_spese (organization_id, ragione_sociale, ragione_sociale_id, descrizione,
                             imponibile, aliquota_iva, iva, importo, data_pagamento, mese_competenza,
                             ricorrente, periodicita, cash_flow_offset_mesi,
                             data_inizio_ricorrenza, data_fine_ricorrenza)
      SELECT organization_id, ragione_sociale, ragione_sociale_id, descrizione,
             imponibile, aliquota_iva, iva, importo, data_pagamento, mese_competenza,
             ricorrente, periodicita, cash_flow_offset_mesi,
             data_inizio_ricorrenza, data_fine_ricorrenza
        FROM cdg_spese WHERE organization_id = $1 AND ricorrenza_id IS NULL AND ricorrente
    `, [session.orgId]);
    // Stessa query del backfill al boot (con la guardia anti-fusione).
    await pool.query(`
      WITH cand AS (
        SELECT s.id, s.organization_id, s.mese_competenza,
               md5(
                 s.organization_id || '|' || s.ragione_sociale || '|' ||
                 COALESCE(s.categoria_id,'') || '|' || COALESCE(s.fornitore_id,'') || '|' ||
                 COALESCE(s.pdv_codice,'') || '|' || s.descrizione || '|' ||
                 s.importo::text || '|' || COALESCE(s.periodicita,'') || '|' ||
                 s.cash_flow_offset_mesi::text || '|' ||
                 COALESCE(s.metodo_pagamento,'') || '|' ||
                 COALESCE(s.data_inizio_ricorrenza::text,'') || '|' ||
                 COALESCE(s.data_fine_ricorrenza::text,'')) AS gid
          FROM cdg_spese s
         WHERE s.ricorrente AND s.ricorrenza_id IS NULL AND s.organization_id = $1
      ), sicuri AS (
        SELECT organization_id, gid
          FROM cand
         GROUP BY organization_id, gid
        HAVING count(*) = count(DISTINCT mese_competenza)
      )
      UPDATE cdg_spese s
         SET ricorrenza_id = c.gid
        FROM cand c
        JOIN sicuri k ON k.organization_id = c.organization_id AND k.gid = c.gid
       WHERE s.id = c.id
    `, [session.orgId]);
    const backfilled = await pool.query(
      `SELECT count(*)::int AS n FROM cdg_spese
        WHERE organization_id = $1 AND descrizione = 'Affitto sede NUOVO' AND ricorrenza_id IS NOT NULL`,
      [session.orgId],
    );
    assert.equal(backfilled.rows[0].n, 0,
      'due serie identiche (mesi competenza duplicati) NON devono essere raggruppate dal backfill');
  } finally {
    await pool.query(`DELETE FROM cdg_spese WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await pool.query(`DELETE FROM cdg_ragioni_sociali WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
