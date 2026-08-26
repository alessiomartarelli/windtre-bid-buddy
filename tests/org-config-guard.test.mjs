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
    [orgId, JSON.stringify({
      puntiVendita: STRUTTURA,
      altroSetting: 'x',
      telegramReport: {
        enabled: true,
        bot_token: 'enc:v1:test-token',
        chat_id: '-1001234567890',
        send_times: { parziale: '13:30', chiusura: '22:15' },
      },
      bisuiteCredentials: {
        api_url: 'https://db1.bisuite.app',
        client_id: 'test-client',
        client_secret: 'enc:v1:test-client-secret',
      },
    })],
  );
}

async function readPv(pool, orgId) {
  const r = await pool.query(
    `SELECT config->'puntiVendita' AS pv FROM organization_config WHERE organization_id = $1`,
    [orgId],
  );
  return r.rows[0]?.pv ?? null;
}

async function readTelegramConfig(pool, orgId) {
  const r = await pool.query(
    `SELECT config->'telegramReport' AS telegram FROM organization_config WHERE organization_id = $1`,
    [orgId],
  );
  return r.rows[0]?.telegram ?? null;
}

async function readBisuiteCredentials(pool, orgId) {
  const r = await pool.query(
    `SELECT config->'bisuiteCredentials' AS credentials FROM organization_config WHERE organization_id = $1`,
    [orgId],
  );
  return r.rows[0]?.credentials ?? null;
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
    const telegramBefore = await readTelegramConfig(pool, session.orgId);
    const bisuiteBefore = await readBisuiteCredentials(pool, session.orgId);

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
    assert.deepEqual(
      await readTelegramConfig(pool, session.orgId),
      telegramBefore,
      'generic save must preserve the Telegram transport configuration',
    );
    assert.deepEqual(
      await readBisuiteCredentials(pool, session.orgId),
      bisuiteBefore,
      'generic save must preserve the BiSuite credentials',
    );

    // (d) puntiVendita: null (non-array) => 200 ma struttura preservata.
    const nullKey = await putConfig(session, { puntiVendita: null });
    assert.equal(nullKey.status, 200, `null puntiVendita must be 200 (re-inject), got ${nullKey.status}`);
    assert.deepEqual(await readPv(pool, session.orgId), STRUTTURA, 'null puntiVendita must not wipe the structure');
    assert.deepEqual(
      await readTelegramConfig(pool, session.orgId),
      telegramBefore,
      'generic save with partial config must keep the Telegram configuration',
    );
    assert.deepEqual(
      await readBisuiteCredentials(pool, session.orgId),
      bisuiteBefore,
      'generic save with partial config must keep the BiSuite credentials',
    );

    // (d2) Telegram ha un endpoint admin dedicato: un payload generico non
    // può né disabilitarlo né sostituire le credenziali di trasporto.
    const attemptedTelegramOverwrite = await putConfig(session, {
      telegramReport: { enabled: false, bot_token: '', chat_id: '' },
    });
    assert.equal(attemptedTelegramOverwrite.status, 200);
    assert.deepEqual(
      await readTelegramConfig(pool, session.orgId),
      telegramBefore,
      'generic save must not overwrite the Telegram transport configuration',
    );

    // (d3) Anche BiSuite ha endpoint admin dedicati: il salvataggio generico
    // non può cancellare o sostituire le credenziali API.
    const attemptedBisuiteOverwrite = await putConfig(session, {
      bisuiteCredentials: {
        api_url: 'https://db1.bisuite.app',
        client_id: 'wrong-client',
        client_secret: 'wrong-secret',
      },
    });
    assert.equal(attemptedBisuiteOverwrite.status, 200);
    assert.deepEqual(
      await readBisuiteCredentials(pool, session.orgId),
      bisuiteBefore,
      'generic save must not overwrite the BiSuite credentials',
    );

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

// === Task #513: le credenziali cifrate non escono dalla route generica ===
//
// La riga organization_config contiene anche bisuiteCredentials (client
// secret cifrato) e telegramReport.bot_token (cifrato). Sono gestiti SOLO
// dagli endpoint admin dedicati: la route generica /api/organization-config
// (accessibile a chiunque abbia uno dei moduli ORG_CONFIG_MODULES) non deve
// restituirli, né nel GET né nell'echo del PUT — altrimenti finiscono anche
// nei log del middleware API.

const getConfig = (session) =>
  jsonReq(`${BASE}/api/organization-config`, {
    headers: { Cookie: session.cookieHeader },
  });

function assertNoSecrets(body, label) {
  const cfg = body?.config ?? {};
  assert.ok(!('bisuiteCredentials' in cfg), `${label}: bisuiteCredentials must be stripped`);
  const tg = cfg.telegramReport;
  if (tg != null) {
    assert.ok(!('bot_token' in tg), `${label}: telegramReport.bot_token must be stripped`);
  }
  assert.ok(!JSON.stringify(body).includes('enc:v1:'), `${label}: no encrypted value may appear in the response`);
}

test('org-config: la risposta generica esclude le credenziali cifrate', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'orgcfg_secrets_test', fullName: 'OrgCfg Secrets Test' });
  try {
    await setRole(pool, session.profileId, 'admin');
    await seedConfig(pool, session.orgId);

    // GET: niente bisuiteCredentials, niente bot_token; il resto della
    // config (struttura, flag Telegram non segreti) resta visibile.
    const got = await getConfig(session);
    assert.equal(got.status, 200, `GET must be 200: ${JSON.stringify(got.body)}`);
    assertNoSecrets(got.body, 'GET');
    assert.deepEqual(got.body.config.puntiVendita, STRUTTURA, 'GET must still return the structure');
    assert.equal(got.body.config.telegramReport.enabled, true, 'non-secret Telegram flags stay visible');
    assert.equal(got.body.config.telegramReport.chat_id, '-1001234567890');

    // PUT: l'echo del salvataggio è anch'esso sanificato, ma i segreti
    // restano intatti nel DB (preservati dalla guardia del PUT generico).
    const telegramBefore = await readTelegramConfig(pool, session.orgId);
    const bisuiteBefore = await readBisuiteCredentials(pool, session.orgId);
    const saved = await putConfig(session, { altroSetting: 'secrets-check' });
    assert.equal(saved.status, 200, `PUT must be 200: ${JSON.stringify(saved.body)}`);
    assertNoSecrets(saved.body, 'PUT echo');
    assert.deepEqual(await readTelegramConfig(pool, session.orgId), telegramBefore, 'PUT must keep Telegram secrets in the DB');
    assert.deepEqual(await readBisuiteCredentials(pool, session.orgId), bisuiteBefore, 'PUT must keep BiSuite credentials in the DB');
  } finally {
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

test('log redaction: valori cifrati e chiavi sensibili annidate mai nei log', async () => {
  const { logJsonReplacer } = await import('../server/logRedact.ts');
  const body = {
    config: {
      bisuiteCredentials: { api_url: 'https://x', client_id: 'id', client_secret: 'enc:v1:abc' },
      telegramReport: { enabled: true, bot_token: 'enc:v1:tok', chat_id: '-100' },
      nested: { deep: { someBlob: 'enc:v2:future-format' } },
      innocuo: 'valore-normale',
    },
    apiKey: 'plain-key',
  };
  const out = JSON.stringify(body, logJsonReplacer);
  assert.ok(!out.includes('enc:v1:'), 'encrypted v1 values must be redacted even under non-sensitive keys');
  assert.ok(!out.includes('enc:v2:'), 'any enc:vN: prefixed value must be redacted');
  assert.ok(!out.includes('plain-key'), 'sensitive keys must be redacted');
  assert.ok(out.includes('valore-normale'), 'normal values must survive');
  assert.ok(out.includes('[redacted]'));
});
