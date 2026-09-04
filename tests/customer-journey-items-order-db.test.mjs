import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  jsonReq,
  signup,
  cleanupOrg,
  newPool,
} from './helpers/uiTest.mjs';

// Ordine stabile degli item di una Customer Journey (DB-backed).
//
// `storage.getCustomerJourneyItems` ordina per data_inserimento DESC con
// tie-break su id ASC: a parità di data (vendita multi-articolo) l'ordine
// restituito dal server deve essere identico su chiamate ripetute, così che
// timeline, export e report vedano sempre la stessa sequenza.
//
// Richiede dev server su :5000 e DATABASE_URL (vedi
// scripts/run-customer-journey-items-order-db-tests.sh).

const CF = 'VRDLGU85M10F205Z';
const SAME_DATE = '2026-03-03T09:30:00.000Z';
const OLDER_DATE = '2026-03-01T09:30:00.000Z';

async function seed(pool, orgId) {
  const j = await pool.query(
    `INSERT INTO customer_journeys (organization_id, customer_key, customer_type, nome, cognome, opened_at)
     VALUES ($1, $2, 'privato', 'Luigi', 'Verdi', $3) RETURNING id`,
    [orgId, CF, OLDER_DATE],
  );
  const journeyId = j.rows[0].id;
  const ins = async (driver, codice, data) => {
    const r = await pool.query(
      `INSERT INTO customer_journey_items
         (journey_id, organization_id, driver, state, cf, codice_contratto, data_inserimento, addetto, categoria, descrizione)
       VALUES ($1, $2, $3::text, 'inserito', $4, $5, $6::timestamptz, 'Anna', $3::text, $3::text) RETURNING id`,
      [journeyId, orgId, driver, CF, codice, data],
    );
    return r.rows[0].id;
  };
  // Due item con la STESSA data_inserimento + uno più vecchio.
  const a = await ins('mobile', 'CJ-ORD-A', SAME_DATE);
  const b = await ins('fisso', 'CJ-ORD-B', SAME_DATE);
  const c = await ins('energia', 'CJ-ORD-C', OLDER_DATE);
  return { journeyId, sameDateIds: [a, b], olderId: c };
}

test('items CJ: ordine identico su chiamate ripetute a parità di data_inserimento', async (t) => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_order_test', fullName: 'CJ Order Test' });
  const { orgId, cookieHeader } = session;
  t.after(async () => {
    await cleanupOrg(pool, orgId);
    await pool.end();
  });

  const { journeyId, sameDateIds, olderId } = await seed(pool, orgId);

  const fetchOrder = async () => {
    const r = await jsonReq(`${BASE}/api/customer-journeys/${journeyId}`, {
      headers: { Cookie: cookieHeader },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.items.map((it) => it.id);
  };

  const first = await fetchOrder();
  assert.equal(first.length, 3);
  assert.equal(first[2], olderId, 'l\'item con data più vecchia è ultimo (DESC)');

  const expectedSame = [...sameDateIds].sort();
  assert.deepEqual(first.slice(0, 2), expectedSame, 'a parità di data il tie-break è id ASC');

  // Chiamate ripetute (anche in parallelo) devono restituire la stessa sequenza.
  const repeats = await Promise.all(Array.from({ length: 6 }, () => fetchOrder()));
  for (const order of repeats) {
    assert.deepEqual(order, first, 'ordine diverso tra due chiamate');
  }
});
