import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  jsonReq,
  signup,
  setRole,
  cleanupOrg,
  newPool,
} from './helpers/uiTest.mjs';

// Test route-level della guardia anti-azzeramento struttura (Task #338).
//
// Incidente 13/08/2026: l'autosave del Simulatore ha sovrascritto
// organization_config.puntiVendita con PDV "scheletro" (anagrafica vuota),
// azzerando la struttura reale di un'org in produzione. La write-protection
// esisteva solo per i non-admin. Questi scenari verificano che il PUT
// generico /api/organization-config, PER GLI ADMIN:
//   (a) rifiuti con 409 l'azzeramento totale (tutti scheletro);
//   (b) rifiuti con 409 l'azzeramento quasi-totale (1 compilato + scheletri
//       al posto di N reali);
//   (c) preservi la struttura quando la chiave è omessa dal payload;
//   (d) preservi la struttura quando la chiave è presente ma non-array (null);
//   (e) accetti le modifiche legittime (rinomina, stesso numero di PDV reali).

const pdvReale = (i) => ({
  id: `pdv-${i}-test`,
  codicePos: `900100${i}`,
  nome: `Negozio ${i}`,
  ragioneSociale: 'Test RS S.R.L',
  canale: 'franchising',
  tipoPosizione: 'strada',
});

const pdvScheletro = (i) => ({
  id: `pdv-${i}-skel`,
  codicePos: '',
  nome: '',
  ragioneSociale: '',
  canale: 'franchising',
  tipoPosizione: 'strada',
  calendar: { weeklySchedule: { workingDays: [1, 2, 3, 4, 5, 6] } },
});

const STRUTTURA = [pdvReale(0), pdvReale(1), pdvReale(2)];

async function seedConfig(pool, orgId) {
  await pool.query(
    `INSERT INTO organization_config (organization_id, config, config_version)
       VALUES ($1, $2, '2.0')
     ON CONFLICT (organization_id)
       DO UPDATE SET config = EXCLUDED.config`,
    [orgId, JSON.stringify({ puntiVendita: STRUTTURA, altroSetting: 'x' })],
  );
}

async function readPv(pool, orgId) {
  const r = await pool.query(
    `SELECT config->'puntiVendita' AS pv FROM organization_config WHERE organization_id = $1`,
    [orgId],
  );
  return r.rows[0]?.pv ?? null;
}

const putConfig = (session, config) =>
  jsonReq(`${BASE}/api/organization-config`, {
    method: 'PUT',
    headers: { Cookie: session.cookieHeader },
    body: JSON.stringify({ config, configVersion: '2.0' }),
  });

test('org-config guard: admin non può azzerare in massa la struttura', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'orgcfg_guard_test', fullName: 'OrgCfg Guard Test' });
  try {
    await setRole(pool, session.profileId, 'admin');
    await seedConfig(pool, session.orgId);

    // (a) tutti scheletro => 409, DB intatto.
    const allSkel = await putConfig(session, {
      altroSetting: 'y',
      puntiVendita: [pdvScheletro(0), pdvScheletro(1), pdvScheletro(2)],
    });
    assert.equal(allSkel.status, 409, `all-skeleton save must be 409, got ${allSkel.status}: ${JSON.stringify(allSkel.body)}`);
    assert.deepEqual(await readPv(pool, session.orgId), STRUTTURA, 'structure must be untouched after 409');

    // (a2) array vuoto => 409.
    const emptyArr = await putConfig(session, { puntiVendita: [] });
    assert.equal(emptyArr.status, 409, `empty-array save must be 409, got ${emptyArr.status}`);

    // (b) quasi-totale: 1 compilato + 2 scheletri al posto di 3 reali => 409.
    const nearTotal = await putConfig(session, {
      puntiVendita: [pdvReale(9), pdvScheletro(1), pdvScheletro(2)],
    });
    assert.equal(nearTotal.status, 409, `near-total blank must be 409, got ${nearTotal.status}: ${JSON.stringify(nearTotal.body)}`);
    assert.deepEqual(await readPv(pool, session.orgId), STRUTTURA, 'structure must be untouched after near-total 409');

    // (c) chiave omessa => 200, struttura preservata, altre chiavi salvate.
    const omitted = await putConfig(session, { altroSetting: 'z' });
    assert.equal(omitted.status, 200, `omitted-key save must be 200: ${JSON.stringify(omitted.body)}`);
    assert.deepEqual(await readPv(pool, session.orgId), STRUTTURA, 'omitted key must re-inject current structure');
    const cfgAfterOmit = await pool.query(
      `SELECT config->>'altroSetting' AS s FROM organization_config WHERE organization_id = $1`,
      [session.orgId],
    );
    assert.equal(cfgAfterOmit.rows[0].s, 'z', 'non-structural settings must still be saved');

    // (d) puntiVendita: null (non-array) => 200 ma struttura preservata.
    const nullKey = await putConfig(session, { puntiVendita: null });
    assert.equal(nullKey.status, 200, `null puntiVendita must be 200 (re-inject), got ${nullKey.status}`);
    assert.deepEqual(await readPv(pool, session.orgId), STRUTTURA, 'null puntiVendita must not wipe the structure');

    // (e) modifica legittima (rinomina, stesso numero di PDV reali) => 200 e applicata.
    const rinominata = [pdvReale(0), { ...pdvReale(1), nome: 'Negozio Rinominato' }, pdvReale(2)];
    const legit = await putConfig(session, { puntiVendita: rinominata });
    assert.equal(legit.status, 200, `legit edit must be 200: ${JSON.stringify(legit.body)}`);
    assert.deepEqual(await readPv(pool, session.orgId), rinominata, 'legit edit must be applied');
  } finally {
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
