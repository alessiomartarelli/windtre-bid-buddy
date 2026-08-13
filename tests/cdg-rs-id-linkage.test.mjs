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

// Task #345 — RS collegate per ID (registro cdg_ragioni_sociali).
//
// Le tabelle CdG (spese, pdv manuali, categorie, fornitori) referenziano le
// Ragioni Sociali per id; i nomi denormalizzati sono solo cache e vengono
// risolti in lettura dal registro. Scenari:
//   (a) create: le righe figlie nascono già collegate per id;
//   (b) rename: una sola PUT sul registro rinomina ovunque (per id);
//   (c) ghost-proof: anche con la cache nomi corrotta a mano in DB, la
//       lettura risolve il nome corrente e la rinomina successiva risana;
//   (d) delete RS: cascade per id anche su righe con nome corrotto.

const api = (session, method, path, body) =>
  jsonReq(`${BASE}${path}`, {
    method,
    headers: { Cookie: session.cookieHeader },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

test('CdG: figli collegati alle RS per id, rename e delete senza fantasmi', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cdg_rs_id_test', fullName: 'Cdg RS Id Test' });
  try {
    await setRole(pool, session.profileId, 'admin');
    const orgId = session.orgId;

    // === Seed: RS manuale + categoria + fornitore + PDV manuale + spesa ===
    const rsA = uniq('RS Id Test A');
    const createRs = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: rsA });
    assert.equal(createRs.status, 201, JSON.stringify(createRs.body));
    const rsId = createRs.body.id;

    const catNome = uniq('Cat Id Test');
    const createCat = await api(session, 'POST', '/api/cdg/categorie', { nome: catNome, ragioniSociali: [rsA] });
    assert.equal(createCat.status, 201, JSON.stringify(createCat.body));
    const catId = createCat.body.id;

    const fornNome = uniq('Forn Id Test');
    const createForn = await api(session, 'POST', '/api/cdg/fornitori', { nome: fornNome, ragioniSociali: [rsA] });
    assert.equal(createForn.status, 201, JSON.stringify(createForn.body));
    const fornId = createForn.body.id;

    const pdvCod = uniq('PV');
    const createPdv = await api(session, 'POST', '/api/cdg/pdv-manuali', {
      ragioneSociale: rsA, codice: pdvCod, nome: 'Pdv Id Test',
    });
    assert.equal(createPdv.status, 201, JSON.stringify(createPdv.body));
    const pdvId = createPdv.body.id;

    const createSpesa = await api(session, 'POST', '/api/cdg/spese', {
      ragioneSociale: rsA, categoriaId: catId, fornitoreId: fornId,
      descrizione: 'Spesa id test', imponibile: '100.00', aliquotaIva: '22',
      dataPagamento: '2026-08-01', meseCompetenza: '2026-08',
    });
    assert.equal(createSpesa.status, 201, JSON.stringify(createSpesa.body));
    const spesaId = createSpesa.body.id;

    // (a) collegamento per id presente in DB su tutte le tabelle figlie
    const spDb = await pool.query('SELECT ragione_sociale_id FROM cdg_spese WHERE id = $1', [spesaId]);
    assert.equal(spDb.rows[0].ragione_sociale_id, rsId, 'spesa collegata per id');
    const pdvDb = await pool.query('SELECT ragione_sociale_id FROM cdg_pdv_manuali WHERE id = $1', [pdvId]);
    assert.equal(pdvDb.rows[0].ragione_sociale_id, rsId, 'pdv manuale collegato per id');
    const catDb = await pool.query('SELECT ragione_sociale_ids FROM cdg_categorie WHERE id = $1', [catId]);
    assert.deepEqual(catDb.rows[0].ragione_sociale_ids, [rsId], 'categoria collegata per id');
    const fornDb = await pool.query('SELECT ragione_sociale_ids FROM cdg_fornitori WHERE id = $1', [fornId]);
    assert.deepEqual(fornDb.rows[0].ragione_sociale_ids, [rsId], 'fornitore collegato per id');

    // (b) rename: PUT sul registro, nessuna propagazione per nome necessaria
    const rsB = uniq('RS Id Test B');
    const rename = await api(session, 'PUT', `/api/cdg/ragioni-sociali/${rsId}`, { nome: rsB });
    assert.equal(rename.status, 200, JSON.stringify(rename.body));

    const spese1 = await api(session, 'GET', `/api/cdg/spese?rs=${encodeURIComponent(rsB)}`);
    assert.equal(spese1.status, 200);
    assert.equal(spese1.body.length, 1, 'spesa filtrabile con nuovo nome');
    assert.equal(spese1.body[0].ragioneSociale, rsB);
    const cat1 = await api(session, 'GET', `/api/cdg/categorie?rs=${encodeURIComponent(rsB)}`);
    assert.equal(cat1.body.length, 1, 'categoria filtrabile con nuovo nome');
    assert.deepEqual(cat1.body[0].ragioniSociali, [rsB]);
    const forn1 = await api(session, 'GET', `/api/cdg/fornitori?rs=${encodeURIComponent(rsB)}`);
    assert.equal(forn1.body.length, 1, 'fornitore filtrabile con nuovo nome');
    const pdv1 = await api(session, 'GET', `/api/cdg/pdv-manuali?rs=${encodeURIComponent(rsB)}`);
    assert.equal(pdv1.body.length, 1, 'pdv manuale filtrabile con nuovo nome');
    assert.equal(pdv1.body[0].ragioneSociale, rsB);

    // (c) ghost-proof: corrompo a mano la cache nomi (simula la vecchia
    // propagazione mancata). La lettura deve comunque risolvere dal registro.
    await pool.query(
      `UPDATE cdg_spese SET ragione_sociale = 'GHOST OLD NAME' WHERE id = $1`, [spesaId]);
    const speseGhost = await api(session, 'GET', `/api/cdg/spese?rs=${encodeURIComponent(rsB)}`);
    assert.equal(speseGhost.body.length, 1, 'spesa con cache corrotta trovata comunque per id');
    assert.equal(speseGhost.body[0].ragioneSociale, rsB, 'nome risolto dal registro, non dalla cache');

    // Modifica della spesa "fantasma": non più bloccata (usava il nome).
    const updSpesa = await api(session, 'PUT', `/api/cdg/spese/${spesaId}`, { descrizione: 'Aggiornata' });
    assert.equal(updSpesa.status, 200, `spesa fantasma modificabile: ${JSON.stringify(updSpesa.body)}`);

    // La rinomina successiva risana anche la riga con cache corrotta.
    const rsC = uniq('RS Id Test C');
    const rename2 = await api(session, 'PUT', `/api/cdg/ragioni-sociali/${rsId}`, { nome: rsC });
    assert.equal(rename2.status, 200, JSON.stringify(rename2.body));
    const spDb2 = await pool.query('SELECT ragione_sociale FROM cdg_spese WHERE id = $1', [spesaId]);
    assert.equal(spDb2.rows[0].ragione_sociale, rsC, 'cache risanata dal rename per id');

    // (d) delete RS: cascade per id anche con cache nomi corrotta
    await pool.query(
      `UPDATE cdg_pdv_manuali SET ragione_sociale = 'GHOST PDV' WHERE id = $1`, [pdvId]);
    const del = await api(session, 'DELETE', `/api/cdg/ragioni-sociali/${rsId}`);
    assert.equal(del.status, 200, JSON.stringify(del.body));
    const left = await pool.query(
      `SELECT (SELECT count(*)::int FROM cdg_spese WHERE organization_id = $1) AS spese,
              (SELECT count(*)::int FROM cdg_pdv_manuali WHERE organization_id = $1) AS pdv,
              (SELECT count(*)::int FROM cdg_categorie WHERE organization_id = $1) AS cat,
              (SELECT count(*)::int FROM cdg_fornitori WHERE organization_id = $1) AS forn`,
      [orgId]);
    assert.deepEqual(left.rows[0], { spese: 0, pdv: 0, cat: 0, forn: 0 },
      'delete RS rimuove i figli per id anche con nomi corrotti');
  } finally {
    await cleanupOrg(pool, session);
    await pool.end();
  }
});

test('CdG: spostare un PDV manuale su altra RS aggancia le spese per id anche con cache corrotta', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cdg_rs_move_test', fullName: 'Cdg RS Move Test' });
  try {
    await setRole(pool, session.profileId, 'admin');
    const rsA = uniq('RS Move A');
    const rsB = uniq('RS Move B');
    const createA = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: rsA });
    const createB = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: rsB });
    assert.equal(createA.status, 201);
    assert.equal(createB.status, 201);
    const idB = createB.body.id;

    const cod = uniq('PVM');
    const createPdv = await api(session, 'POST', '/api/cdg/pdv-manuali', {
      ragioneSociale: rsA, codice: cod, nome: 'Pdv Move Test',
    });
    assert.equal(createPdv.status, 201, JSON.stringify(createPdv.body));
    const createSpesa = await api(session, 'POST', '/api/cdg/spese', {
      ragioneSociale: rsA, pdvCodice: cod,
      descrizione: 'Spesa move test', imponibile: '50.00', aliquotaIva: '22',
      dataPagamento: '2026-08-01', meseCompetenza: '2026-08',
    });
    assert.equal(createSpesa.status, 201, JSON.stringify(createSpesa.body));
    const spesaId = createSpesa.body.id;

    // Corrompi la cache nomi della spesa (vecchio scenario "propagazione mancata"):
    // il collegamento per id resta corretto, il nome no.
    await pool.query(`UPDATE cdg_spese SET ragione_sociale = 'GHOST STALE A' WHERE id = $1`, [spesaId]);

    // Sposta il PDV manuale su RS B: la spesa deve seguire, selezionata per id.
    const move = await api(session, 'PUT', `/api/cdg/pdv-manuali/${createPdv.body.id}`, { ragioneSociale: rsB });
    assert.equal(move.status, 200, JSON.stringify(move.body));
    const spDb = await pool.query('SELECT ragione_sociale, ragione_sociale_id FROM cdg_spese WHERE id = $1', [spesaId]);
    assert.equal(spDb.rows[0].ragione_sociale_id, idB, 'spesa riagganciata per id alla nuova RS');
    assert.equal(spDb.rows[0].ragione_sociale, rsB, 'cache nomi risanata');
    const spese = await api(session, 'GET', `/api/cdg/spese?rs=${encodeURIComponent(rsB)}`);
    assert.equal(spese.body.length, 1, 'spesa filtrabile sotto la nuova RS');
  } finally {
    await cleanupOrg(pool, session);
    await pool.end();
  }
});

test('CdG: spostare un PDV ereditato su altra RS aggancia le spese per id anche con cache corrotta', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cdg_rs_inh_move_test', fullName: 'Cdg RS Inh Move Test' });
  try {
    await setRole(pool, session.profileId, 'admin');
    const rsX = uniq('RS Inh X');
    const rsY = uniq('RS Inh Y');
    // Struttura ereditata: due RS con un PDV ciascuna.
    await pool.query(
      `INSERT INTO organization_config (organization_id, config, config_version)
         VALUES ($1, $2, '2.0')
       ON CONFLICT (organization_id) DO UPDATE SET config = EXCLUDED.config`,
      [session.orgId, JSON.stringify({
        puntiVendita: [
          { ragioneSociale: rsX, codicePos: 'CX1', nome: 'Pdv X1' },
          { ragioneSociale: rsY, codicePos: 'CY1', nome: 'Pdv Y1' },
        ],
      })],
    );

    const createSpesa = await api(session, 'POST', '/api/cdg/spese', {
      ragioneSociale: rsX, pdvCodice: 'CX1',
      descrizione: 'Spesa inh move', imponibile: '80.00', aliquotaIva: '22',
      dataPagamento: '2026-08-01', meseCompetenza: '2026-08',
    });
    assert.equal(createSpesa.status, 201, JSON.stringify(createSpesa.body));
    const spesaId = createSpesa.body.id;

    // Cache nomi corrotta, collegamento per id intatto.
    await pool.query(`UPDATE cdg_spese SET ragione_sociale = 'GHOST STALE X' WHERE id = $1`, [spesaId]);

    // Sposta il PDV ereditato su RS Y.
    const move = await api(session, 'PUT', '/api/cdg/pdv-inherited', {
      ragioneSociale: rsX, codice: 'CX1', newRagioneSociale: rsY,
    });
    assert.equal(move.status, 200, JSON.stringify(move.body));
    const spDb = await pool.query(
      `SELECT s.ragione_sociale, r.nome AS rs_nome
         FROM cdg_spese s LEFT JOIN cdg_ragioni_sociali r ON r.id = s.ragione_sociale_id
        WHERE s.id = $1`, [spesaId]);
    assert.equal(spDb.rows[0].rs_nome, rsY, 'spesa riagganciata per id alla RS destinazione');
    assert.equal(spDb.rows[0].ragione_sociale, rsY, 'cache nomi risanata');
    const spese = await api(session, 'GET', `/api/cdg/spese?rs=${encodeURIComponent(rsY)}`);
    assert.equal(spese.body.length, 1, 'spesa filtrabile sotto la RS destinazione');
    assert.equal(spese.body[0].pdvCodice, 'CX1');
  } finally {
    await cleanupOrg(pool, session);
    await pool.end();
  }
});

test('CdG: RS con stesso nome di anchor auto viene promossa, non 409', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cdg_rs_anchor_test', fullName: 'Cdg RS Anchor Test' });
  try {
    await setRole(pool, session.profileId, 'admin');
    const nome = uniq('RS Anchor Promo');
    // Simula un anchor 'auto' pre-esistente (es. creato dal backfill).
    await pool.query(
      `INSERT INTO cdg_ragioni_sociali (organization_id, nome, origine) VALUES ($1, $2, 'auto')`,
      [session.orgId, nome]);
    // Non deve essere visibile come RS manuale...
    const list0 = await api(session, 'GET', '/api/cdg/ragioni-sociali');
    assert.equal(list0.body.some(r => r.nome === nome), false, 'anchor auto non listato come manuale');
    // ...ma la creazione manuale con lo stesso nome promuove l'anchor (201).
    const create = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome, partitaIva: '12345678901' });
    assert.equal(create.status, 201, JSON.stringify(create.body));
    const db = await pool.query(
      `SELECT origine, partita_iva, count(*) OVER () AS tot FROM cdg_ragioni_sociali WHERE organization_id = $1 AND nome = $2`,
      [session.orgId, nome]);
    assert.equal(db.rows.length, 1, 'una sola riga registro (promossa, non duplicata)');
    assert.equal(db.rows[0].origine, 'manuale');
    assert.equal(db.rows[0].partita_iva, '12345678901');
    // Un secondo tentativo con lo stesso nome ora è un vero duplicato: 409.
    const dup = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome });
    assert.equal(dup.status, 409, JSON.stringify(dup.body));
  } finally {
    await cleanupOrg(pool, session);
    await pool.end();
  }
});
