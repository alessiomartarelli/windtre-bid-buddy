import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  uniq,
  jsonReq,
  signup,
  cleanupOrg,
  newPool,
} from './helpers/uiTest.mjs';

// Test suite DB-backed dell'esito economico Customer Journey ← DRMS.
//
// Copre il percorso completo server-side (docs/customer-journey.md, "Esito
// economico da DRMS"):
//   1. il caricamento di un DRMS (POST /api/drms) applica automaticamente il
//      motore di esito agli item CJ dell'org: stato economico, competenza DRMS
//      e riferimento alla riga (stato/competenza/causale/importo/SEQ_ID/upload);
//   2. lo stato OPERATIVO non viene toccato;
//   3. uno stato economico impostato a mano (PATCH economic-state) non viene
//      sovrascritto e, se diverso dall'esito DRMS, alza `drms_mismatch`;
//      tornare ad "automatico" (null) riallinea allo stato DRMS;
//   4. "Esita da DRMS" (POST /api/customer-journeys/esita-drms, admin)
//      rielabora tutti gli upload e restituisce il riepilogo;
//   5. l'eliminazione dell'upload azzera gli esiti derivati dal DRMS;
//   6. gli upload "legacy" (righe senza chiavi di esito) sono segnalati nel
//      riepilogo, nella lista DRMS (hasOutcomeFields) e in drms-status.
//
// Richiede dev server su :5000 e DATABASE_URL (vedi scripts/run-customer-
// journey-drms-outcome-db-tests.sh). Gli item CJ sono inseriti direttamente
// nel DB (il reconcile BiSuite è coperto da customer-journey-reconcile).

const CF = 'RSSMRA80A01H501U';

async function seedJourney(pool, orgId) {
  const j = await pool.query(
    `INSERT INTO customer_journeys (organization_id, customer_key, customer_type, nome, cognome, opened_at)
     VALUES ($1, $2, 'privato', 'Mario', 'Rossi', '2026-02-05T00:00:00.000Z') RETURNING id`,
    [orgId, CF],
  );
  const journeyId = j.rows[0].id;
  const ins = async (driver, extra) => {
    const r = await pool.query(
      `INSERT INTO customer_journey_items
         (journey_id, organization_id, driver, state, cf, codice_contratto, pod, pdr, data_inserimento, addetto, categoria, descrizione)
       VALUES ($1, $2, $3, 'inserito', $4, $5, $6, $7, '2026-02-05T10:00:00.000Z', 'Anna', $8::text, $8::text)
       RETURNING id`,
      [journeyId, orgId, driver, CF, extra.codice ?? null, extra.pod ?? null, extra.pdr ?? null, extra.desc ?? driver],
    );
    return r.rows[0].id;
  };
  return {
    journeyId,
    mobileId: await ins('mobile', { codice: 'CJ-MOB-001', desc: 'SIM mobile' }),
    energiaId: await ins('energia', { codice: 'BIS-EN-77', pod: 'IT001E00000777', desc: 'Luce' }),
    fissoId: await ins('fisso', { codice: 'CJ-FIS-001', desc: 'Fibra' }),
    telefonoId: await ins('telefono', { codice: 'CJ-TEL-001', desc: 'iPhone' }),
  };
}

function drmsRows() {
  let seq = 62572570000000;
  const base = (over) => ({
    SEQ_ID: String(++seq),
    NATURA: 'CONTRATTUALE',
    TIPO_TRANSAZIONE: 'Activation',
    TIPO_FONIA: 'MOBILE',
    DESCRIZIONE_EVENTO: 'Contrattuale Attivazioni Mobile',
    CAUSALE_STORNO: '',
    IMPORTO: '5',
    IMPORTO_NUM: 5,
    COMPETENZA: '2026-02',
    DATA_EVENTO: '2026-02-17',
    CODICE_CONTRATTO: 'CJ-MOB-001',
    FISCAL_CODE: CF,
    P_IVA_CLIENTE: '',
    POD_PDR: '',
    DT_ATTIVAZIONE: '2026-02-10',
    CAPITOLO: 'MOBILE',
    ...over,
  });
  return [
    // mobile: pagato (+ una riga GARE che non conta)
    base({}),
    base({ NATURA: 'GARE', DESCRIZIONE_EVENTO: 'Gara Reload Forever', IMPORTO: '20', IMPORTO_NUM: 20 }),
    // energia: match per POD, codice DRMS diverso da quello BiSuite → pagato
    base({ TIPO_FONIA: 'ENERGIA', TIPO_TRANSAZIONE: 'W3 Energy', DESCRIZIONE_EVENTO: 'Contrat Attiv Luce e Gas_New', CODICE_CONTRATTO: 'DRMS-EN-1', POD_PDR: 'IT001E00000777' }),
    // fisso: annullato (DINIEGO, importo 0)
    base({ TIPO_FONIA: 'FISSO', TIPO_TRANSAZIONE: 'Bundle Activation', DESCRIZIONE_EVENTO: 'Attivazione Fonia Fissa GA', CODICE_CONTRATTO: 'CJ-FIS-001', IMPORTO: '0', IMPORTO_NUM: 0, CAUSALE_STORNO: 'DINIEGO' }),
    // telefono: nessuna riga (non trovato)
  ];
}

async function itemsById(pool, orgId) {
  const r = await pool.query(
    `SELECT id, state, economic_state, economic_state_manual, drms_competenza, drms_outcome_state,
            drms_outcome_competenza, drms_outcome_causale, drms_outcome_importo, drms_outcome_seq_id,
            drms_outcome_upload_id, drms_outcome_match, drms_mismatch
       FROM customer_journey_items WHERE organization_id = $1`,
    [orgId],
  );
  return new Map(r.rows.map((row) => [row.id, row]));
}

test('DRMS → esito economico: upload, stato manuale, esita-drms, delete', async (t) => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_drms_test', fullName: 'CJ DRMS Test' });
  const { orgId, cookieHeader } = session;
  t.after(async () => {
    await cleanupOrg(pool, orgId);
    await pool.end();
  });

  const ids = await seedJourney(pool, orgId);

  // Stato economico MANUALE sul fisso PRIMA dell'upload: il DRMS dirà
  // "annullato" ⇒ incongruenza, ma lo stato resta "pagato".
  const manual = await jsonReq(`${BASE}/api/customer-journey-items/${ids.fissoId}/economic-state`, {
    method: 'PATCH',
    headers: { Cookie: cookieHeader },
    body: JSON.stringify({ economicState: 'pagato' }),
  });
  assert.equal(manual.status, 200, JSON.stringify(manual.body));
  assert.equal(manual.body.economicState, 'pagato');
  assert.equal(manual.body.economicStateManual, true);
  assert.equal(manual.body.drmsMismatch, false, 'nessun esito DRMS ancora ⇒ nessuna incongruenza');

  const bad = await jsonReq(`${BASE}/api/customer-journey-items/${ids.fissoId}/economic-state`, {
    method: 'PATCH',
    headers: { Cookie: cookieHeader },
    body: JSON.stringify({ economicState: 'attivato' }),
  });
  assert.equal(bad.status, 400, 'uno stato operativo non è accettato come economico');

  // 1) Upload DRMS ⇒ applicazione automatica.
  const rows = drmsRows();
  const up = await jsonReq(`${BASE}/api/drms`, {
    method: 'POST',
    headers: { Cookie: cookieHeader },
    body: JSON.stringify({
      fileName: `drms_${uniq('t')}.xlsx`, month: 2, year: 2026, period: 'FEB-26',
      totaleImporto: 30, righeCount: rows.length, rows,
    }),
  });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const uploadId = up.body.id;
  assert.ok(up.body.cjOutcomes, 'la risposta include il riepilogo esiti CJ');
  assert.equal(up.body.cjOutcomes.items, 4);
  assert.equal(up.body.cjOutcomes.matched, 3);
  assert.equal(up.body.cjOutcomes.notFound, 1);
  assert.equal(up.body.cjOutcomes.mismatches, 1);
  assert.deepEqual(up.body.cjOutcomes.byState, { pagato: 2, annullato: 1, stornato: 0, riaccreditato: 0 });

  let m = await itemsById(pool, orgId);
  const mob = m.get(ids.mobileId);
  assert.equal(mob.state, 'inserito', 'lo stato operativo NON viene toccato');
  assert.equal(mob.economic_state, 'pagato');
  assert.equal(mob.economic_state_manual, false);
  assert.equal(mob.drms_competenza, '2026-02');
  assert.equal(mob.drms_outcome_state, 'pagato');
  assert.equal(mob.drms_outcome_competenza, '2026-02');
  assert.equal(Number(mob.drms_outcome_importo), 5);
  assert.equal(mob.drms_outcome_seq_id, rows[0].SEQ_ID);
  assert.equal(mob.drms_outcome_upload_id, uploadId);
  assert.equal(mob.drms_outcome_match, 'contratto');
  assert.equal(mob.drms_mismatch, false);

  const en = m.get(ids.energiaId);
  assert.equal(en.economic_state, 'pagato');
  assert.equal(en.drms_outcome_match, 'pod_pdr');

  const fis = m.get(ids.fissoId);
  assert.equal(fis.economic_state, 'pagato', 'stato manuale non sovrascritto');
  assert.equal(fis.economic_state_manual, true);
  assert.equal(fis.drms_outcome_state, 'annullato');
  assert.equal(fis.drms_outcome_causale, 'DINIEGO');
  assert.equal(fis.drms_mismatch, true, 'manuale ≠ DRMS ⇒ incongruenza');

  const tel = m.get(ids.telefonoId);
  assert.equal(tel.economic_state, null);
  assert.equal(tel.drms_outcome_state, null);
  assert.equal(tel.drms_mismatch, false);

  // Il dettaglio journey espone i nuovi campi e il riepilogo driver considera
  // il fisso "pagato" (manuale) attivo, il telefono senza esito attivo.
  const det = await jsonReq(`${BASE}/api/customer-journeys/${ids.journeyId}`, { headers: { Cookie: cookieHeader } });
  assert.equal(det.status, 200);
  const detMob = det.body.items.find((it) => it.id === ids.mobileId);
  assert.equal(detMob.economicState, 'pagato');
  assert.equal(detMob.drmsOutcomeCausale, '');
  const drv = new Map(det.body.drivers.map((d) => [d.driver, d]));
  assert.equal(drv.get('fisso').activated, true);
  assert.equal(drv.get('telefono').activated, true);

  // 2) Stato manuale sul mobile diverso dal DRMS ⇒ mismatch subito.
  const man2 = await jsonReq(`${BASE}/api/customer-journey-items/${ids.mobileId}/economic-state`, {
    method: 'PATCH',
    headers: { Cookie: cookieHeader },
    body: JSON.stringify({ economicState: 'stornato' }),
  });
  assert.equal(man2.status, 200);
  assert.equal(man2.body.economicState, 'stornato');
  assert.equal(man2.body.drmsMismatch, true);
  // Il report ora non conta il mobile come attivo (stornato).
  const rep = await jsonReq(`${BASE}/api/customer-journeys/report`, { headers: { Cookie: cookieHeader } });
  assert.equal(rep.status, 200);
  const repMob = rep.body.find((r) => r.driver === 'mobile' && r.journeyId === ids.journeyId);
  assert.equal(repMob.state, 'inserito');
  assert.equal(repMob.economicState, 'stornato');

  // 3) Esita da DRMS: lo stato manuale resta, il riepilogo conta l'incongruenza.
  const esita = await jsonReq(`${BASE}/api/customer-journeys/esita-drms`, {
    method: 'POST',
    headers: { Cookie: cookieHeader },
  });
  assert.equal(esita.status, 200, JSON.stringify(esita.body));
  assert.equal(esita.body.uploads, 1);
  assert.equal(esita.body.matched, 3);
  assert.equal(esita.body.mismatches, 2, 'fisso (pagato vs annullato) + mobile (stornato vs pagato)');
  m = await itemsById(pool, orgId);
  assert.equal(m.get(ids.mobileId).economic_state, 'stornato');
  assert.equal(m.get(ids.mobileId).drms_mismatch, true);

  // Torna ad "automatico" ⇒ riallineato al DRMS, nessuna incongruenza.
  const auto = await jsonReq(`${BASE}/api/customer-journey-items/${ids.mobileId}/economic-state`, {
    method: 'PATCH',
    headers: { Cookie: cookieHeader },
    body: JSON.stringify({ economicState: null }),
  });
  assert.equal(auto.status, 200);
  assert.equal(auto.body.economicState, 'pagato');
  assert.equal(auto.body.economicStateManual, false);
  assert.equal(auto.body.drmsMismatch, false);

  // 4) Facet stati della lista: include gli stati economici (filtro "Stato").
  const list = await jsonReq(`${BASE}/api/customer-journeys`, { headers: { Cookie: cookieHeader } });
  assert.equal(list.status, 200);
  const lj = list.body.find((j) => j.id === ids.journeyId);
  assert.ok(lj, 'journey in lista');
  assert.ok(lj.states.includes('inserito') && lj.states.includes('pagato') && lj.states.includes('annullato') === false,
    `facet stati: ${JSON.stringify(lj.states)}`);

  // 4b) Upload "legacy" (righe salvate dal vecchio parser, SENZA chiavi di
  // esito): il riepilogo lo elenca con file/periodo, la lista DRMS lo marca
  // e lo stato DRMS lato CJ lo espone; gli esiti degli altri item non cambiano.
  const legacyRows = drmsRows().map((r) => {
    const { FISCAL_CODE, P_IVA_CLIENTE, POD_PDR, CAUSALE_STORNO, DATA_EVENTO, TIPO_TRANSAZIONE, ...rest } = r;
    return { ...rest, SEQ_ID: `L${rest.SEQ_ID}`, COMPETENZA: '2026-01' };
  });
  assert.ok(!('POD_PDR' in legacyRows[0]));
  const upLegacy = await jsonReq(`${BASE}/api/drms`, {
    method: 'POST',
    headers: { Cookie: cookieHeader },
    body: JSON.stringify({
      fileName: 'drms_gen_26_legacy.xlsx', month: 1, year: 2026, period: 'GEN-26',
      totaleImporto: 10, righeCount: legacyRows.length, rows: legacyRows,
    }),
  });
  assert.equal(upLegacy.status, 200, JSON.stringify(upLegacy.body));
  const legacyId = upLegacy.body.id;
  assert.equal(upLegacy.body.cjOutcomes.uploads, 2);
  assert.equal(upLegacy.body.cjOutcomes.matched, 3, 'gli esiti degli upload nuovi restano');
  assert.equal(upLegacy.body.cjOutcomes.legacyRows, legacyRows.length);
  assert.deepEqual(upLegacy.body.cjOutcomes.legacyUploads, [{
    uploadId: legacyId, fileName: 'drms_gen_26_legacy.xlsx', period: 'GEN-26', month: 1, year: 2026, rows: legacyRows.length,
  }]);
  assert.deepEqual(upLegacy.body.cjOutcomes.notFoundByDriver, { telefono: 1 });

  const lst = await jsonReq(`${BASE}/api/drms`, { headers: { Cookie: cookieHeader } });
  assert.equal(lst.status, 200);
  const flags = new Map(lst.body.map((u) => [u.id, u.hasOutcomeFields]));
  assert.equal(flags.get(uploadId), true);
  assert.equal(flags.get(legacyId), false);

  const st = await jsonReq(`${BASE}/api/customer-journeys/drms-status`, { headers: { Cookie: cookieHeader } });
  assert.equal(st.status, 200, JSON.stringify(st.body));
  assert.equal(st.body.uploads, 2);
  assert.deepEqual(st.body.legacyUploads.map((l) => l.uploadId), [legacyId]);
  assert.equal(st.body.legacyUploads[0].period, 'GEN-26');

  const esita2 = await jsonReq(`${BASE}/api/customer-journeys/esita-drms`, { method: 'POST', headers: { Cookie: cookieHeader } });
  assert.equal(esita2.status, 200);
  assert.equal(esita2.body.legacyUploads.length, 1, 'anche "Esita da DRMS" segnala gli upload legacy');

  const delLegacy = await jsonReq(`${BASE}/api/drms/${legacyId}`, { method: 'DELETE', headers: { Cookie: cookieHeader } });
  assert.equal(delLegacy.status, 200);
  const st2 = await jsonReq(`${BASE}/api/customer-journeys/drms-status`, { headers: { Cookie: cookieHeader } });
  assert.deepEqual(st2.body, { uploads: 1, legacyUploads: [] });

  // 5) Delete upload ⇒ esiti DRMS azzerati; il manuale (fisso) resta, senza mismatch.
  const del = await jsonReq(`${BASE}/api/drms/${uploadId}`, { method: 'DELETE', headers: { Cookie: cookieHeader } });
  assert.equal(del.status, 200);
  m = await itemsById(pool, orgId);
  assert.equal(m.get(ids.mobileId).economic_state, null);
  assert.equal(m.get(ids.mobileId).drms_outcome_state, null);
  assert.equal(m.get(ids.mobileId).drms_competenza, null);
  assert.equal(m.get(ids.fissoId).economic_state, 'pagato');
  assert.equal(m.get(ids.fissoId).drms_mismatch, false);
});
