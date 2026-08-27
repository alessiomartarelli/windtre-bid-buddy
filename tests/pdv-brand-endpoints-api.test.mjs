import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE,
  uniq,
  jsonReq,
  signup,
  newPool,
  cleanupOrg,
} from './helpers/uiTest.mjs';

// Test API (senza browser) per gli endpoint dedicati della struttura
// (Task #522): POST e PUT /api/admin/struttura/pdv devono RIFIUTARE con 400
// i brandIds non associati all'organizzazione (validateBrandIds in
// server/routes.ts) senza salvare nulla, e devono deduplicare i brandIds
// validi al salvataggio. Dal Task #523 anche il PUT generico
// /api/organization-config rifiuta con 400 i brand estranei (stessa
// semantica): la suite UI pdv-brand-persistence copre quel percorso.
//
// Seed diretto nel dev DB (brands + organization_brands), come nella suite
// UI. Cleanup completo (org + brand) alla fine.

async function seedOrgBrands(pool, orgId, count = 2) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const name = uniq(`BrandApi${i}`);
    const r = await pool.query(`INSERT INTO brands (name) VALUES ($1) RETURNING id, name`, [name]);
    await pool.query(
      `INSERT INTO organization_brands (organization_id, brand_id) VALUES ($1, $2)`,
      [orgId, r.rows[0].id],
    );
    out.push(r.rows[0]);
  }
  return out;
}

async function seedForeignBrand(pool) {
  const r = await pool.query(
    `INSERT INTO brands (name) VALUES ($1) RETURNING id, name`,
    [uniq('BrandForeignApi')],
  );
  return r.rows[0];
}

async function cleanupBrands(pool, brands) {
  for (const b of brands) {
    await pool.query(`DELETE FROM brands WHERE id = $1`, [b.id]).catch(() => {});
  }
}

async function readPersistedPdvs(pool, orgId) {
  const r = await pool.query(
    `SELECT config -> 'puntiVendita' AS pv
       FROM organization_config
      WHERE organization_id = $1
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1`,
    [orgId],
  );
  const pv = r.rows[0]?.pv;
  return Array.isArray(pv) ? pv : [];
}

function pdvBody(overrides = {}) {
  return {
    codicePos: uniq('POS'),
    nome: uniq('PdvApi'),
    ragioneSociale: 'RS Api Test',
    ...overrides,
  };
}

test('struttura PDV endpoints: brand estranei rifiutati, dedup applicato', async (t) => {
  const pool = await newPool();
  const session = await signup({ prefix: 'pdv_brand_api' });
  const brands = await seedOrgBrands(pool, session.orgId, 2);
  const foreign = await seedForeignBrand(pool);
  const allBrands = [...brands, foreign];
  const headers = { Cookie: session.cookieHeader };

  t.after(async () => {
    await cleanupBrands(pool, allBrands);
    await cleanupOrg(pool, session);
    await pool.end();
  });

  await t.test('POST con brandId estraneo → 400 e nessun PDV salvato', async () => {
    const body = pdvBody({ brandIds: [brands[0].id, foreign.id] });
    const r = await jsonReq(`${BASE}/api/admin/struttura/pdv`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.match(String(r.body?.error || ''), /Brand non associati/i);
    const pv = await readPersistedPdvs(pool, session.orgId);
    assert.equal(pv.some((p) => p.codicePos === body.codicePos), false, 'PDV must NOT be saved');
  });

  await t.test('POST con brandIds validi duplicati → 201 e dedup persistito', async () => {
    const body = pdvBody({ brandIds: [brands[0].id, brands[1].id, brands[0].id] });
    const r = await jsonReq(`${BASE}/api/admin/struttura/pdv`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 201, `create failed: ${JSON.stringify(r.body)}`);
    const pv = await readPersistedPdvs(pool, session.orgId);
    const saved = pv.find((p) => p.codicePos === body.codicePos);
    assert.ok(saved, 'PDV should be saved');
    assert.deepEqual([...saved.brandIds].sort(), [brands[0].id, brands[1].id].sort());
    assert.equal(saved.brandIds.length, 2, 'brandIds must be deduped');
  });

  await t.test('PUT con brandId estraneo → 400 e brandIds intatti', async () => {
    // Crea un PDV pulito con un brand valido...
    const body = pdvBody({ brandIds: [brands[0].id] });
    const create = await jsonReq(`${BASE}/api/admin/struttura/pdv`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(create.status, 201, `create failed: ${JSON.stringify(create.body)}`);

    // ...poi prova a spingergli un brand estraneo via PUT dedicato.
    const put = await jsonReq(`${BASE}/api/admin/struttura/pdv`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        oldRagioneSociale: body.ragioneSociale,
        oldCodicePos: body.codicePos,
        nome: 'Nome Cambiato',
        brandIds: [foreign.id],
      }),
    });
    assert.equal(put.status, 400, `expected 400, got ${put.status}: ${JSON.stringify(put.body)}`);
    assert.match(String(put.body?.error || ''), /Brand non associati/i);

    const pv = await readPersistedPdvs(pool, session.orgId);
    const saved = pv.find((p) => p.codicePos === body.codicePos);
    assert.ok(saved, 'PDV must still exist');
    assert.equal(saved.nome, body.nome, 'nome must NOT be updated on rejected PUT');
    assert.deepEqual(saved.brandIds, [brands[0].id], 'brandIds must be untouched');
  });

  await t.test('PUT con brandIds validi duplicati → 200 e dedup persistito', async () => {
    const body = pdvBody({ brandIds: [] });
    const create = await jsonReq(`${BASE}/api/admin/struttura/pdv`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(create.status, 201, `create failed: ${JSON.stringify(create.body)}`);

    const put = await jsonReq(`${BASE}/api/admin/struttura/pdv`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        oldRagioneSociale: body.ragioneSociale,
        oldCodicePos: body.codicePos,
        brandIds: [brands[1].id, brands[1].id, brands[0].id],
      }),
    });
    assert.equal(put.status, 200, `put failed: ${JSON.stringify(put.body)}`);

    const pv = await readPersistedPdvs(pool, session.orgId);
    const saved = pv.find((p) => p.codicePos === body.codicePos);
    assert.ok(saved, 'PDV must exist');
    assert.deepEqual([...saved.brandIds].sort(), [brands[0].id, brands[1].id].sort());
    assert.equal(saved.brandIds.length, 2, 'brandIds must be deduped');
  });

  await t.test('POST bulk con brandIds validi duplicati → dedup persistito per ogni PDV', async () => {
    const a = pdvBody({ brandIds: [brands[0].id, brands[0].id] });
    const b = pdvBody({ brandIds: [brands[1].id, brands[0].id, brands[1].id] });
    const r = await jsonReq(`${BASE}/api/admin/struttura/pdv/bulk`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ pdvs: [a, b] }),
    });
    assert.equal(r.status, 200, `bulk failed: ${JSON.stringify(r.body)}`);
    assert.deepEqual(r.body?.added?.sort(), [a.codicePos, b.codicePos].sort());
    const pv = await readPersistedPdvs(pool, session.orgId);
    const savedA = pv.find((p) => p.codicePos === a.codicePos);
    const savedB = pv.find((p) => p.codicePos === b.codicePos);
    assert.ok(savedA && savedB, 'both bulk PDVs must be saved');
    assert.deepEqual(savedA.brandIds, [brands[0].id], 'bulk PDV A brandIds must be deduped');
    assert.deepEqual([...savedB.brandIds].sort(), [brands[0].id, brands[1].id].sort());
    assert.equal(savedB.brandIds.length, 2, 'bulk PDV B brandIds must be deduped');
  });

  await t.test('POST bulk con brandId estraneo → 400 e nessun PDV salvato', async () => {
    const good = pdvBody({ brandIds: [brands[0].id] });
    const bad = pdvBody({ brandIds: [foreign.id] });
    const r = await jsonReq(`${BASE}/api/admin/struttura/pdv/bulk`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ pdvs: [good, bad] }),
    });
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.match(String(r.body?.error || ''), /Brand non associati/i);
    const pv = await readPersistedPdvs(pool, session.orgId);
    assert.equal(pv.some((p) => p.codicePos === good.codicePos), false, 'no bulk PDV must be saved');
    assert.equal(pv.some((p) => p.codicePos === bad.codicePos), false, 'no bulk PDV must be saved');
  });
});

// Task #524: la dissociazione di un brand dall'org (PUT
// /api/admin/organizations/:id/brands) deve ripulire i riferimenti residui
// nei brandIds dei puntiVendita, altrimenti ogni salvataggio successivo di
// quei PDV fallirebbe con 400 (validateBrandIds) finché qualcuno non li
// ripulisce a mano.
test('dissociazione brand dall\'org: ripulisce i brandIds residui e il PDV resta salvabile', async (t) => {
  const pool = await newPool();
  const session = await signup({ prefix: 'pdv_brand_dis' });
  // Il PUT dei brand org richiede super_admin: promuovi l'utente di test.
  await pool.query(`UPDATE profiles SET role = 'super_admin' WHERE id = $1`, [session.profileId]);
  const brands = await seedOrgBrands(pool, session.orgId, 2);
  const headers = { Cookie: session.cookieHeader };

  t.after(async () => {
    await cleanupBrands(pool, brands);
    await cleanupOrg(pool, session);
    await pool.end();
  });

  // 1) PDV con entrambi i brand associati.
  const body = pdvBody({ brandIds: [brands[0].id, brands[1].id] });
  const create = await jsonReq(`${BASE}/api/admin/struttura/pdv`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(create.status, 201, `create failed: ${JSON.stringify(create.body)}`);

  // 2) Dissocia brands[1] dall'org (PUT sostituisce l'insieme).
  const dis = await jsonReq(`${BASE}/api/admin/organizations/${session.orgId}/brands`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ brandIds: [brands[0].id] }),
  });
  assert.equal(dis.status, 200, `dissociate failed: ${JSON.stringify(dis.body)}`);
  assert.deepEqual(dis.body?.brandIds, [brands[0].id]);
  assert.equal(dis.body?.pdvPuliti, 1, 'one PDV must be cleaned');

  // 3) Il riferimento residuo è stato rimosso dal PDV.
  const pv = await readPersistedPdvs(pool, session.orgId);
  const saved = pv.find((p) => p.codicePos === body.codicePos);
  assert.ok(saved, 'PDV must still exist');
  assert.deepEqual(saved.brandIds, [brands[0].id], 'residual brandId must be removed');

  // 4) Il PDV resta salvabile: PUT senza toccare i brandIds → 200 (non 400).
  const put = await jsonReq(`${BASE}/api/admin/struttura/pdv`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      oldRagioneSociale: body.ragioneSociale,
      oldCodicePos: body.codicePos,
      nome: 'Nome Dopo Dissociazione',
      brandIds: saved.brandIds,
    }),
  });
  assert.equal(put.status, 200, `PDV must stay saveable after brand removal, got ${put.status}: ${JSON.stringify(put.body)}`);

  const pv2 = await readPersistedPdvs(pool, session.orgId);
  const saved2 = pv2.find((p) => p.codicePos === body.codicePos);
  assert.equal(saved2?.nome, 'Nome Dopo Dissociazione');
  assert.deepEqual(saved2?.brandIds, [brands[0].id]);

  // 5) Riassociare non deve toccare nulla (nessun PDV "pulito").
  const reassoc = await jsonReq(`${BASE}/api/admin/organizations/${session.orgId}/brands`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ brandIds: [brands[0].id, brands[1].id] }),
  });
  assert.equal(reassoc.status, 200);
  assert.equal(reassoc.body?.pdvPuliti, 0, 'no PDV must be touched when brands are re-added');
});
