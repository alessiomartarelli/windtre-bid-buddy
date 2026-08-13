import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  BASE,
  uniq as uniqHttp,
  jsonReq,
  signup,
  setRole,
  cleanupOrg as cleanupHttpOrg,
  newPool,
} from './helpers/uiTest.mjs';

// Task #353 — Spesa ricorrente atomica: nessuna mensilità orfana su fallimento.
//
// La creazione di una spesa ricorrente (POST /api/cdg/spese) scrive master e
// cloni in un'UNICA transazione (cdgStorage.createSpesaConRicorrenza).
// Questa suite verifica:
//   1. (DB-backed, storage diretto via tsx) happy path: master + N cloni
//      tutti creati, allegato SOLO sulla master, collegamento RS per id;
//   2. (DB-backed) rollback: se UN clone è invalido a livello DB la
//      transazione fallisce e NESSUNA riga resta in cdg_spese — nemmeno la
//      master già inserita — né l'anchor RS creato nella stessa tx;
//   3. (HTTP, end-to-end) POST /api/cdg/spese con allegato + transazione che
//      fallisce DAVVERO (fault injection via header di test, solo fuori
//      produzione): risposta 500 con messaggio chiaro, 0 righe scritte e il
//      file allegato rimosso automaticamente dal ramo d'errore della route
//      (allegato non orfano).
//
// Richiede il dev server su http://localhost:5000 e DATABASE_URL.

const { cdgStorage } = await import('../server/cdgStorage.ts');
const { pool } = await import('../server/db.ts');

const uniq = (p) => `${p}_${crypto.randomBytes(4).toString('hex')}`;

after(async () => {
  await pool.end().catch(() => {});
});

async function createOrg() {
  const r = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [uniq('CdgRicRollback')],
  );
  return r.rows[0].id;
}

async function cleanupOrg(orgId) {
  // Figli prima dell'org (FK NO ACTION): niente org di test vuote residue.
  await pool.query(`DELETE FROM cdg_spese WHERE organization_id = $1`, [orgId]);
  await pool.query(`DELETE FROM cdg_ragioni_sociali WHERE organization_id = $1`, [orgId]);
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
}

function baseSpesa(orgId, rs, overrides = {}) {
  return {
    organizationId: orgId,
    ragioneSociale: rs,
    descrizione: 'Affitto test rollback',
    imponibile: '1000.00',
    aliquotaIva: '22.00',
    iva: '220.00',
    importo: '1220.00',
    dataPagamento: '2027-01-31',
    meseCompetenza: '2027-01',
    ricorrente: true,
    periodicita: 'mensile',
    cashFlowOffsetMesi: 0,
    dataInizioRicorrenza: '2027-01-31',
    dataFineRicorrenza: '2027-03-31',
    ...overrides,
  };
}

async function countSpese(orgId) {
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM cdg_spese WHERE organization_id = $1`, [orgId]);
  return r.rows[0].n;
}

test('happy path: master + cloni creati atomicamente, allegato solo sulla master', async () => {
  const orgId = await createOrg();
  try {
    const rs = uniq('RS Ric');
    const master = await cdgStorage.createSpesaConRicorrenza(
      baseSpesa(orgId, rs, {
        allegatoPath: 'uploads/cdg/fake/fattura.pdf',
        allegatoNome: 'fattura.pdf',
        allegatoMime: 'application/pdf',
      }),
      [
        { dataPagamento: '2027-02-28', meseCompetenza: '2027-02' },
        { dataPagamento: '2027-03-31', meseCompetenza: '2027-03' },
      ],
    );
    assert.ok(master.id, 'ritorna la master');
    assert.equal(master.meseCompetenza, '2027-01');

    const rows = await pool.query(
      `SELECT mese_competenza AS mc, allegato_path AS ap, ragione_sociale_id AS rsid
         FROM cdg_spese WHERE organization_id = $1 ORDER BY mese_competenza`, [orgId]);
    assert.deepEqual(rows.rows.map(r => r.mc), ['2027-01', '2027-02', '2027-03']);
    assert.equal(rows.rows[0].ap, 'uploads/cdg/fake/fattura.pdf', 'allegato sulla master');
    assert.equal(rows.rows[1].ap, null, 'clone senza allegato');
    assert.equal(rows.rows[2].ap, null, 'clone senza allegato');
    // Anchor RS creato e agganciato per id su TUTTE le occorrenze.
    const rsId = await cdgStorage.getRsIdByName(orgId, rs);
    assert.ok(rsId, 'anchor RS creato');
    for (const r of rows.rows) assert.equal(r.rsid, rsId, 'collegamento RS per id');
  } finally {
    await cleanupOrg(orgId);
  }
});

test('rollback: un clone invalido => 0 righe in cdg_spese', async () => {
  const orgId = await createOrg();
  try {
    const rs = uniq('RS Rollback');
    // Clone #2 invalido a livello DB: mese_competenza è varchar(7), 8 char
    // violano il vincolo => la INSERT del clone fallisce DOPO che master e
    // clone #1 sono già stati scritti nella transazione.
    await assert.rejects(
      cdgStorage.createSpesaConRicorrenza(
        baseSpesa(orgId, rs),
        [
          { dataPagamento: '2027-02-28', meseCompetenza: '2027-02' },
          { dataPagamento: '2027-03-31', meseCompetenza: '2027-003' }, // 8 char
        ],
      ),
      'la creazione con clone invalido deve fallire',
    );

    // NESSUNA riga scritta: né master né cloni.
    assert.equal(await countSpese(orgId), 0, 'rollback totale: 0 righe in cdg_spese');
    // Nemmeno l'anchor RS creato nella stessa transazione deve sopravvivere.
    assert.equal(await cdgStorage.getRsIdByName(orgId, rs), null, 'anchor RS rollbackato');
  } finally {
    await cleanupOrg(orgId);
  }
});

test('HTTP: POST /api/cdg/spese con tx fallita => 500 chiaro, 0 righe, allegato NON orfano', async () => {
  const httpPool = await newPool();
  const session = await signup({ prefix: 'cdg_ric_rb_test', fullName: 'Cdg Ric Rollback Test' });
  const uploadDir = process.env.CDG_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'cdg');
  const orgDir = path.join(uploadDir, session.orgId);
  try {
    await setRole(httpPool, session.profileId, 'admin');
    const rs = uniqHttp('RS Ric HTTP');
    const createRs = await jsonReq(`${BASE}/api/cdg/ragioni-sociali`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ nome: rs }),
    });
    assert.equal(createRs.status, 201, `create RS: ${JSON.stringify(createRs.body)}`);

    const spesa = {
      ragioneSociale: rs,
      descrizione: 'Affitto rollback http',
      imponibile: '1000',
      aliquotaIva: '22',
      dataPagamento: '2027-01-31',
      meseCompetenza: '2027-01',
      ricorrente: true,
      periodicita: 'mensile',
      dataInizioRicorrenza: '2027-01-31',
      dataFineRicorrenza: '2027-03-31',
      allegatoBase64: Buffer.from('%PDF-1.4 fattura di test rollback').toString('base64'),
      allegatoNome: 'fattura_rollback.pdf',
      allegatoMime: 'application/pdf',
    };

    // Fault injection (solo NODE_ENV != production): la route aggiunge un
    // clone invalido a livello DB, quindi la VERA transazione master+cloni
    // fallisce DOPO che l'allegato è già stato salvato su disco.
    const fail = await jsonReq(`${BASE}/api/cdg/spese`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader, 'x-test-cdg-force-tx-fail': '1' },
      body: JSON.stringify(spesa),
    });
    assert.equal(fail.status, 500, `atteso 500: ${JSON.stringify(fail.body)}`);
    assert.match(String(fail.body?.error || ''), /nessuna occorrenza è stata salvata/i,
      'errore chiaro sulla spesa ricorrente');

    // 0 righe in cdg_spese per l'org.
    const n = await httpPool.query(
      `SELECT count(*)::int AS n FROM cdg_spese WHERE organization_id = $1`, [session.orgId]);
    assert.equal(n.rows[0].n, 0, 'rollback totale via API: 0 righe');

    // L'allegato salvato prima della transazione è stato rimosso dalla route
    // (ramo catch): la cartella upload dell'org non deve contenere file.
    const files = await fs.readdir(orgDir).catch(() => []);
    assert.deepEqual(files, [], `allegato orfano trovato: ${files.join(', ')}`);

    // Controprova: senza header di test la stessa richiesta va a buon fine
    // (master + 2 cloni) e l'allegato resta SOLO sulla master.
    const ok = await jsonReq(`${BASE}/api/cdg/spese`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify(spesa),
    });
    assert.equal(ok.status, 201, `atteso 201: ${JSON.stringify(ok.body)}`);
    const rows = await httpPool.query(
      `SELECT mese_competenza AS mc, allegato_path AS ap
         FROM cdg_spese WHERE organization_id = $1 ORDER BY mese_competenza`, [session.orgId]);
    assert.deepEqual(rows.rows.map(r => r.mc), ['2027-01', '2027-02', '2027-03']);
    assert.ok(rows.rows[0].ap, 'allegato sulla master');
    assert.equal(rows.rows[1].ap, null);
    assert.equal(rows.rows[2].ap, null);
    const okFiles = await fs.readdir(orgDir).catch(() => []);
    assert.equal(okFiles.length, 1, 'un solo file su disco (quello della master)');
  } finally {
    await fs.rm(orgDir, { recursive: true, force: true }).catch(() => {});
    await httpPool.query(`DELETE FROM cdg_spese WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await httpPool.query(`DELETE FROM cdg_ragioni_sociali WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await cleanupHttpOrg(httpPool, session);
    await httpPool.end().catch(() => {});
  }
});

test('rollback: master invalida => 0 righe scritte', async () => {
  const orgId = await createOrg();
  try {
    await assert.rejects(
      cdgStorage.createSpesaConRicorrenza(
        baseSpesa(orgId, uniq('RS BadMaster'), { dataPagamento: 'non-una-data' }),
        [{ dataPagamento: '2027-02-28', meseCompetenza: '2027-02' }],
      ),
      'la creazione con master invalida deve fallire',
    );
    assert.equal(await countSpese(orgId), 0, '0 righe scritte');
  } finally {
    await cleanupOrg(orgId);
  }
});
