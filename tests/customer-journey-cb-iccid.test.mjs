import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BASE, signup, newPool, seedJourney, cleanupOrg, jsonReq } from './helpers/uiTest.mjs';

test('detail exposes CB ICCID without widening organization or operator scope', async () => {
  const pool = await newPool();
  const sessions = [];
  try {
    const owner = await signup({ prefix: 'cj_cb_iccid', fullName: 'Synthetic Admin' });
    sessions.push(owner);
    const other = await signup({ prefix: 'cj_cb_foreign', fullName: 'Synthetic Foreign' });
    sessions.push(other);
    const A = '8939000000000000011', B = '8939000000000000022';
    const saleIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, addetto, iccid] of [[0, 'Synthetic Mario', A], [1, 'Synthetic Anna', B], [2, 'Synthetic Mario', B]]) {
      await pool.query(`INSERT INTO bisuite_sales
        (id, organization_id, bisuite_id, nome_addetto, nome_negozio, data_vendita, raw_data)
        VALUES ($1,$2,$3,$4,'Synthetic PDV',now(),$5::jsonb)`,
      [saleIds[index], index === 2 ? other.orgId : owner.orgId, index + 1, addetto,
        JSON.stringify({ articoli: [
          { categoria: { nome: 'RIVINCOLO' }, descrizione: 'Synthetic CB',
            dettaglio: { venditaInfo1: `ICCID: ${iccid}` } },
          { categoria: { nome: 'TELEFONIA' }, descrizione: 'Synthetic Phone',
            dettaglio: { venditaInfo1: `ICCID: ${iccid}` } },
        ] })]);
    }
    const journeyId = await seedJourney(pool, owner.orgId, {
      customerKey: randomUUID(), nome: 'Synthetic Customer',
      items: [
        { driver: 'mobile', addetto: 'Synthetic Mario', iccid: A, bisuiteSaleId: saleIds[0] },
        { driver: 'telefono', addetto: 'Synthetic Anna', iccid: B, bisuiteSaleId: saleIds[1] },
        // Even a corrupt cross-tenant sale pointer must not expose its CB metadata.
        { driver: 'telefono', addetto: 'Synthetic Mario', iccid: B, bisuiteSaleId: saleIds[2] },
      ],
    });
    const detail = session => jsonReq(`${BASE}/api/customer-journeys/${journeyId}`, {
      headers: { Cookie: session.cookieHeader },
    });
    const admin = await detail(owner);
    assert.equal(admin.status, 200);
    assert.equal(admin.body.cbSimReferences.length, 2);
    assert.deepEqual(admin.body.cbSimReferences.map(r => r.iccid).sort(), [A, B].sort());
    assert.ok(admin.body.cbSimReferences.every(r => !r.id.startsWith(saleIds[2])));
    assert.equal(admin.body.items.length, 3);
    assert.ok(admin.body.drivers.every(r => r.driver !== 'cb'));
    assert.equal((await detail(other)).status, 404);

    await pool.query(`UPDATE profiles SET role='operatore', bisuite_addetti=$2 WHERE id=$1`,
      [owner.profileId, ['Synthetic Mario']]);
    const operator = await detail(owner);
    assert.equal(operator.status, 200);
    assert.equal(operator.body.cbSimReferences.length, 1);
    assert.equal(operator.body.cbSimReferences[0].iccid, A);
    await pool.query(`UPDATE profiles SET bisuite_addetti=$2 WHERE id=$1`, [owner.profileId, []]);
    assert.equal((await detail(owner)).status, 403);
  } finally {
    for (const session of sessions) await cleanupOrg(pool, session);
    await pool.end();
  }
});
