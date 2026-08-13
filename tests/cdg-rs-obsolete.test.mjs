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

// RS obsolete nelle anagrafiche CdG (incidente "CMS Evolution Srl non valida").
//
// Quando una Ragione Sociale viene rinominata/rimossa, le categorie/fornitori
// che la referenziano per nome restano con selezioni "fantasma": il dialogo di
// modifica le rimandava al server, che rifiutava l'intero salvataggio (400) e
// rendeva la voce immodificabile. Questi scenari verificano che:
//   (a) il PUT scarta le RS obsolete e salva quelle valide (non più 400);
//   (b) il PUT con SOLO RS obsolete resta un 400 esplicito;
//   (c) la rinomina di una RS manuale si propaga alle voci che la referenziano.

const api = (session, method, path, body) =>
  jsonReq(`${BASE}${path}`, {
    method,
    headers: { Cookie: session.cookieHeader },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

test('RS obsolete: salvataggio non più bloccato, rinomina propagata', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cdg_rs_obsolete_test', fullName: 'Cdg RS Obsolete Test' });
  try {
    await setRole(pool, session.profileId, 'admin');

    // Seed: due RS manuali valide.
    const rsA = uniq('RS Valida A');
    const rsB = uniq('RS Valida B');
    const createA = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: rsA });
    assert.equal(createA.status, 201, `create RS A: ${JSON.stringify(createA.body)}`);
    const createB = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: rsB });
    assert.equal(createB.status, 201, `create RS B: ${JSON.stringify(createB.body)}`);

    // Categoria associata ad A.
    const catNome = uniq('Affitti Test');
    const createCat = await api(session, 'POST', '/api/cdg/categorie', { nome: catNome, ragioniSociali: [rsA] });
    assert.equal(createCat.status, 201, `create categoria: ${JSON.stringify(createCat.body)}`);
    const catId = createCat.body.id;

    // Inietta una RS fantasma direttamente in DB (simula la rinomina avvenuta altrove).
    const ghost = uniq('RS Fantasma');
    await pool.query(
      `UPDATE cdg_categorie SET ragioni_sociali = array_append(ragioni_sociali, $1) WHERE id = $2`,
      [ghost, catId],
    );

    // (a) PUT con [fantasma, A, B] => 200 e in DB restano solo A e B.
    const put = await api(session, 'PUT', `/api/cdg/categorie/${catId}`, {
      nome: catNome,
      ragioniSociali: [ghost, rsA, rsB],
    });
    assert.equal(put.status, 200, `PUT con RS fantasma deve riuscire, got ${put.status}: ${JSON.stringify(put.body)}`);
    const after = await pool.query(`SELECT ragioni_sociali FROM cdg_categorie WHERE id = $1`, [catId]);
    assert.deepEqual(
      [...after.rows[0].ragioni_sociali].sort(),
      [rsA, rsB].sort(),
      'la RS fantasma deve essere scartata, le valide preservate',
    );

    // (b) PUT con SOLO RS fantasma => 400 esplicito.
    const putGhostOnly = await api(session, 'PUT', `/api/cdg/categorie/${catId}`, {
      ragioniSociali: [ghost],
    });
    assert.equal(putGhostOnly.status, 400, `PUT con sole RS fantasma deve dare 400, got ${putGhostOnly.status}`);

    // PDV manuale su A: la rinomina deve propagarsi anche qui.
    const pdvCod = uniq('COD');
    const createPdv = await api(session, 'POST', '/api/cdg/pdv-manuali', { ragioneSociale: rsA, codice: pdvCod, nome: 'PDV Test' });
    assert.equal(createPdv.status, 201, `create pdv manuale: ${JSON.stringify(createPdv.body)}`);

    // (c) Rinomina RS manuale A => propagata alla categoria.
    const rsARenamed = uniq('RS Rinominata');
    const rename = await api(session, 'PUT', `/api/cdg/ragioni-sociali/${createA.body.id}`, { nome: rsARenamed });
    assert.equal(rename.status, 200, `rename RS: ${JSON.stringify(rename.body)}`);
    const afterRename = await pool.query(`SELECT ragioni_sociali FROM cdg_categorie WHERE id = $1`, [catId]);
    assert.deepEqual(
      [...afterRename.rows[0].ragioni_sociali].sort(),
      [rsARenamed, rsB].sort(),
      'la rinomina della RS deve propagarsi alle categorie che la referenziano',
    );

    const pdvAfter = await pool.query(
      `SELECT ragione_sociale FROM cdg_pdv_manuali WHERE organization_id = $1 AND codice = $2`,
      [session.orgId, pdvCod],
    );
    assert.equal(pdvAfter.rows[0]?.ragione_sociale, rsARenamed, 'la rinomina deve propagarsi ai PDV manuali');

    // Rinomina su nome già esistente => 409.
    const renameClash = await api(session, 'PUT', `/api/cdg/ragioni-sociali/${createA.body.id}`, { nome: rsB });
    assert.equal(renameClash.status, 409, `rename su nome esistente deve dare 409, got ${renameClash.status}`);

    // Collisione PDV su rinomina verso un nome orfano che ha già lo stesso
    // codice => 409 preflight, nessuna modifica parziale.
    const orfana = uniq('RS Orfana');
    await pool.query(
      `INSERT INTO cdg_pdv_manuali (organization_id, ragione_sociale, codice, nome) VALUES ($1, $2, $3, 'PDV Orfano')`,
      [session.orgId, orfana, pdvCod],
    );
    const renameCollide = await api(session, 'PUT', `/api/cdg/ragioni-sociali/${createA.body.id}`, { nome: orfana });
    assert.equal(renameCollide.status, 409, `rename con collisione PDV deve dare 409, got ${renameCollide.status}: ${JSON.stringify(renameCollide.body)}`);
    const rsUnchanged = await pool.query(`SELECT nome FROM cdg_ragioni_sociali WHERE id = $1`, [createA.body.id]);
    assert.equal(rsUnchanged.rows[0]?.nome, rsARenamed, 'la RS non deve cambiare dopo il 409 di collisione');
  } finally {
    await pool.query(`DELETE FROM cdg_pdv_manuali WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await pool.query(`DELETE FROM cdg_categorie WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await pool.query(`DELETE FROM cdg_ragioni_sociali WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
