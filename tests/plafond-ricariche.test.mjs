// Task #537 — Plafond ricariche per Ragione Sociale.
//
// Copre:
//  - consumo derivato dagli articoli RICARICHE (annullate escluse);
//  - operazioni admin 'imposta' e 'aggiungi' (saldo derivato, mai contatore);
//  - nessuna doppia sottrazione dopo risincronizzazioni ripetute;
//  - annullamento post-consumo che ripristina il saldo;
//  - storico append-only con RS, tipo, importo, saldo prima/dopo, utente, data;
//  - operatore: lettura ok, modifica vietata (403);
//  - isolamento per organizzazione (saldi + storico);
//  - lastSync = max(last_seen_at) delle vendite dell'org;
//  - UI: card plafond, controlli solo admin, "Ultimo aggiornamento" visibile.
//
// Richiede il dev server su http://localhost:5000 e DATABASE_URL.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE, uniq, jsonReq, signup, newPool, setRole, cleanupOrg,
  launchBrowser, newAuthedContext,
} from './helpers/uiTest.mjs';

// Wall-time italiano "YYYY-MM-DD HH:mm:ss" (stessa convenzione di data_vendita).
function italianWallNow(offsetMs = 0) {
  const d = new Date(Date.now() + offsetMs);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
}

const artRicarica = (prezzo) => ({
  tipo: 'P',
  categoria: { nome: 'RICARICHE' },
  tipologia: { nome: 'RICARICA' },
  descrizione: 'RICARICA TEST',
  dettaglio: { prezzo: String(prezzo) },
});

const artAccessorio = (prezzo) => ({
  tipo: 'P',
  categoria: { nome: 'ACCESSORI' },
  tipologia: { nome: 'COVER' },
  descrizione: 'ACCESSORIO TEST',
  dettaglio: { prezzo: String(prezzo) },
});

async function insertSale(pool, orgId, { ragioneSociale, articoli, stato = 'Completata', dataVendita, codicePos = 'POS1', addetto = 'ADDETTO TEST' }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  const r = await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        ragione_sociale, nome_addetto, stato, totale, raw_data)
     VALUES ($1, $2, $3::timestamp, $7, 'NEGOZIO TEST', $4, $8, $5, '0', $6::jsonb)
     RETURNING id`,
    [orgId, bisuiteId, dataVendita ?? italianWallNow(-3_600_000), ragioneSociale, stato,
      JSON.stringify({ articoli, pagamento: {} }), codicePos, addetto],
  );
  return r.rows[0].id;
}

const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();

test('plafond ricariche per RS', async (t) => {
  const pool = await newPool();
  const admin = await signup({ prefix: 'plafond_admin', fullName: 'Plafond Admin' });
  const other = await signup({ prefix: 'plafond_other', fullName: 'Plafond Other' });
  const RS_A = uniq('RS PLAFOND A').toUpperCase().replace(/_/g, ' ');
  const RS_B = uniq('RS PLAFOND B').toUpperCase().replace(/_/g, ' ');
  const idA = slug(RS_A);

  const get = (path, session = admin) =>
    jsonReq(`${BASE}${path}`, { headers: { Cookie: session.cookieHeader } });
  const post = (path, body, session = admin) =>
    jsonReq(`${BASE}${path}`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify(body),
    });

  let consumedSaleId;

  try {
    // Seed: ricarica valida 30 (annullata 20 esclusa), accessorio non conta.
    await insertSale(pool, admin.orgId, { ragioneSociale: RS_A, articoli: [artRicarica('30.00')] });
    await insertSale(pool, admin.orgId, { ragioneSociale: RS_A, articoli: [artRicarica('20.00')], stato: 'Annullata' });
    await insertSale(pool, admin.orgId, { ragioneSociale: RS_A, articoli: [artAccessorio('99.00')] });

    await t.test('consumo derivato: annullate e non-ricariche escluse', async () => {
      const r = await get('/api/ricariche-plafond');
      assert.equal(r.status, 200);
      const row = r.body.saldi.find((s) => s.ragioneSociale === RS_A);
      assert.ok(row, `RS mancante nei saldi: ${JSON.stringify(r.body.saldi)}`);
      assert.equal(row.saldo, null); // plafond mai configurato
      assert.equal(row.consumoTotale, 30);
      assert.ok(r.body.lastSync, 'lastSync deve essere valorizzato dopo il seed');
    });

    await t.test("'imposta' fissa il saldo e il consumo riparte dal cutoff", async () => {
      const r = await post('/api/ricariche-plafond', { ragioneSociale: RS_A, tipo: 'imposta', importo: 100 });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.saldo, 100);

      // Nuova ricarica DOPO il cutoff: decurtata dal saldo impostato.
      consumedSaleId = await insertSale(pool, admin.orgId, {
        ragioneSociale: RS_A,
        articoli: [artRicarica('25.00')],
        dataVendita: italianWallNow(120_000),
      });
      const r2 = await get('/api/ricariche-plafond');
      const row = r2.body.saldi.find((s) => s.ragioneSociale === RS_A);
      assert.equal(row.saldo, 75);
    });

    await t.test('risincronizzazioni ripetute non sottraggono due volte', async () => {
      // Simula 3 sync successive: last_seen_at aggiornato sulla stessa vendita.
      for (let i = 0; i < 3; i++) {
        await pool.query(
          `UPDATE bisuite_sales SET last_seen_at = now(), fetched_at = now() WHERE id = $1`,
          [consumedSaleId],
        );
      }
      const r = await get('/api/ricariche-plafond');
      const row = r.body.saldi.find((s) => s.ragioneSociale === RS_A);
      assert.equal(row.saldo, 75, 'il saldo deve restare invariato dopo le risync');
    });

    await t.test('annullamento post-consumo ripristina il saldo', async () => {
      await pool.query(`UPDATE bisuite_sales SET stato = 'Annullata' WHERE id = $1`, [consumedSaleId]);
      const r = await get('/api/ricariche-plafond');
      const row = r.body.saldi.find((s) => s.ragioneSociale === RS_A);
      assert.equal(row.saldo, 100);
      // Ripristina lo stato per i test successivi.
      await pool.query(`UPDATE bisuite_sales SET stato = 'Completata' WHERE id = $1`, [consumedSaleId]);
    });

    await t.test("'aggiungi' somma al saldo corrente e lo storico è completo", async () => {
      const r = await post('/api/ricariche-plafond', { ragioneSociale: RS_A, tipo: 'aggiungi', importo: 50 });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.op.saldoPrima, 75);
      assert.equal(r.body.op.saldoDopo, 125);

      const st = await get('/api/ricariche-plafond/storico');
      assert.equal(st.status, 200);
      assert.equal(st.body.storico.length, 2);
      const [last, first] = st.body.storico; // desc
      assert.equal(last.tipo, 'aggiungi');
      assert.equal(last.importo, 50);
      assert.equal(last.saldoPrima, 75);
      assert.equal(last.saldoDopo, 125);
      assert.equal(last.ragioneSociale, RS_A);
      assert.equal(last.utente, 'Plafond Admin');
      assert.ok(last.createdAt);
      assert.equal(first.tipo, 'imposta');
      assert.equal(first.importo, 100);
    });

    await t.test('soglia di avviso: default, custom, allerta e disattivazione (Task #538)', async () => {
      // Saldo attuale RS_A = 125, soglia default 50 ⇒ nessuna allerta.
      let r = await get('/api/ricariche-plafond');
      let row = r.body.saldi.find((s) => s.ragioneSociale === RS_A);
      assert.equal(row.soglia, 50, 'senza op soglia vale il default di sistema');
      assert.equal(row.sogliaCustom, false);
      assert.equal(row.inAllerta, false);

      // Soglia custom sopra il saldo ⇒ in allerta (saldo positivo).
      const w = await post('/api/ricariche-plafond', { ragioneSociale: RS_A, tipo: 'soglia', importo: 200 });
      assert.equal(w.status, 201, JSON.stringify(w.body));
      assert.equal(w.body.saldo, 125, "l'op soglia non deve toccare il saldo");
      r = await get('/api/ricariche-plafond');
      row = r.body.saldi.find((s) => s.ragioneSociale === RS_A);
      assert.equal(row.saldo, 125);
      assert.equal(row.soglia, 200);
      assert.equal(row.sogliaCustom, true);
      assert.equal(row.inAllerta, true);

      // Lo storico registra l'operazione con saldo invariato.
      const st = await get('/api/ricariche-plafond/storico');
      const opSoglia = st.body.storico[0];
      assert.equal(opSoglia.tipo, 'soglia');
      assert.equal(opSoglia.importo, 200);
      assert.equal(opSoglia.saldoPrima, 125);
      assert.equal(opSoglia.saldoDopo, 125);

      // Soglia 0 = disattivata: niente allerta finché il saldo è >= 0.
      assert.equal((await post('/api/ricariche-plafond', { ragioneSociale: RS_A, tipo: 'soglia', importo: 0 })).status, 201);
      r = await get('/api/ricariche-plafond');
      row = r.body.saldi.find((s) => s.ragioneSociale === RS_A);
      assert.equal(row.soglia, null);
      assert.equal(row.inAllerta, false);

      // Saldo negativo ⇒ sempre in allerta, anche con soglia disattivata.
      const bigSaleId = await insertSale(pool, admin.orgId, {
        ragioneSociale: RS_A,
        articoli: [artRicarica('500.00')],
        dataVendita: italianWallNow(180_000),
      });
      r = await get('/api/ricariche-plafond');
      row = r.body.saldi.find((s) => s.ragioneSociale === RS_A);
      assert.ok(row.saldo < 0);
      assert.equal(row.inAllerta, true);
      // Ripristina: annulla la vendita e riporta la soglia al default.
      await pool.query(`UPDATE bisuite_sales SET stato = 'Annullata' WHERE id = $1`, [bigSaleId]);
      assert.equal((await post('/api/ricariche-plafond', { ragioneSociale: RS_A, tipo: 'soglia', importo: 50 })).status, 201);
      r = await get('/api/ricariche-plafond');
      row = r.body.saldi.find((s) => s.ragioneSociale === RS_A);
      assert.equal(row.saldo, 125);
      assert.equal(row.inAllerta, false);

      // Una RS con SOLA op soglia resta "plafond non configurato".
      const RS_S = uniq('RS PLAFOND SOGLIA').toUpperCase().replace(/_/g, ' ');
      assert.equal((await post('/api/ricariche-plafond', { ragioneSociale: RS_S, tipo: 'soglia', importo: 30 })).status, 201);
      r = await get('/api/ricariche-plafond');
      row = r.body.saldi.find((s) => s.ragioneSociale === RS_S);
      assert.ok(row);
      assert.equal(row.saldo, null);
      assert.equal(row.inAllerta, false);

      // Soglia negativa rifiutata.
      assert.equal((await post('/api/ricariche-plafond', { ragioneSociale: RS_A, tipo: 'soglia', importo: -1 })).status, 400);
    });

    await t.test('input non validi rifiutati', async () => {
      assert.equal((await post('/api/ricariche-plafond', { ragioneSociale: RS_A, tipo: 'aggiungi', importo: -5 })).status, 400);
      assert.equal((await post('/api/ricariche-plafond', { ragioneSociale: RS_A, tipo: 'aggiungi', importo: 0 })).status, 400);
      assert.equal((await post('/api/ricariche-plafond', { ragioneSociale: RS_A, tipo: 'boh', importo: 5 })).status, 400);
      assert.equal((await post('/api/ricariche-plafond', { ragioneSociale: '', tipo: 'imposta', importo: 5 })).status, 400);
    });

    await t.test('operatore: lettura scoped ai propri addetti, modifica 403', async () => {
      await setRole(pool, admin.profileId, 'operatore');
      try {
        // Nessun addetto associato → nessun saldo né storico visibile.
        await pool.query(`UPDATE profiles SET bisuite_addetti = ARRAY[]::text[] WHERE id = $1`, [admin.profileId]);
        let r = await get('/api/ricariche-plafond');
        assert.equal(r.status, 200);
        assert.equal(r.body.saldi.length, 0, 'operatore senza addetti non deve vedere saldi');
        let st = await get('/api/ricariche-plafond/storico');
        assert.equal(st.status, 200);
        assert.equal(st.body.storico.length, 0, 'operatore senza addetti non deve vedere storico');

        // Addetto pertinente → vede la RS delle sue vendite (e il suo storico).
        await pool.query(`UPDATE profiles SET bisuite_addetti = ARRAY['ADDETTO TEST'] WHERE id = $1`, [admin.profileId]);
        r = await get('/api/ricariche-plafond');
        assert.ok(r.body.saldi.find((s) => s.ragioneSociale === RS_A), 'operatore con addetto pertinente vede la sua RS');
        st = await get('/api/ricariche-plafond/storico');
        // 2 op saldo (imposta+aggiungi) + 3 op soglia del test precedente.
        assert.equal(st.body.storico.length, 5);
        assert.ok(st.body.storico.every((o) => o.ragioneSociale === RS_A));

        // Addetto estraneo → di nuovo nulla.
        await pool.query(`UPDATE profiles SET bisuite_addetti = ARRAY['ALTRO ADDETTO'] WHERE id = $1`, [admin.profileId]);
        r = await get('/api/ricariche-plafond');
        assert.equal(r.body.saldi.find((s) => s.ragioneSociale === RS_A), undefined);

        // La scrittura resta vietata in ogni caso.
        await pool.query(`UPDATE profiles SET bisuite_addetti = ARRAY['ADDETTO TEST'] WHERE id = $1`, [admin.profileId]);
        const w = await post('/api/ricariche-plafond', { ragioneSociale: RS_A, tipo: 'aggiungi', importo: 10 });
        assert.equal(w.status, 403);
      } finally {
        await pool.query(`UPDATE profiles SET bisuite_addetti = ARRAY[]::text[] WHERE id = $1`, [admin.profileId]);
        await setRole(pool, admin.profileId, 'admin');
      }
    });

    await t.test('isolamento per organizzazione', async () => {
      // L'org B non vede né i saldi né lo storico dell'org A.
      const r = await get('/api/ricariche-plafond', other);
      assert.equal(r.status, 200);
      assert.equal(r.body.saldi.find((s) => s.ragioneSociale === RS_A), undefined);
      const st = await get('/api/ricariche-plafond/storico', other);
      assert.equal(st.body.storico.length, 0);

      // Un'operazione nell'org B non tocca il saldo dell'org A.
      await insertSale(pool, other.orgId, { ragioneSociale: RS_B, articoli: [artRicarica('10.00')] });
      const w = await post('/api/ricariche-plafond', { ragioneSociale: RS_B, tipo: 'imposta', importo: 500 }, other);
      assert.equal(w.status, 201);
      const rA = await get('/api/ricariche-plafond');
      assert.equal(rA.body.saldi.find((s) => s.ragioneSociale === RS_A).saldo, 125);
      assert.equal(rA.body.saldi.find((s) => s.ragioneSociale === RS_B), undefined);

      // Cross-org via query param vietato per non super_admin.
      const x = await get(`/api/ricariche-plafond?organization_id=${admin.orgId}`, other);
      assert.equal(x.status, 403);
    });

    await t.test('RS del registro senza vendite: plafond impostabile in via preventiva', async () => {
      // RS appena creata nel registro, nessuna vendita RICARICHE.
      const RS_NEW = uniq('RS PLAFOND NUOVA').toUpperCase().replace(/_/g, ' ');
      await pool.query(
        `INSERT INTO cdg_ragioni_sociali (organization_id, nome, origine) VALUES ($1, $2, 'manuale')`,
        [admin.orgId, RS_NEW],
      );
      // Compare nell'elenco con plafond non configurato e consumo 0.
      const r0 = await get('/api/ricariche-plafond');
      const row0 = r0.body.saldi.find((s) => s.ragioneSociale === RS_NEW);
      assert.ok(row0, 'la RS del registro senza vendite deve comparire nei saldi');
      assert.equal(row0.saldo, null);
      assert.equal(row0.consumoTotale, 0);
      // L'admin può impostare il saldo prima della prima ricarica venduta.
      const w = await post('/api/ricariche-plafond', { ragioneSociale: RS_NEW, tipo: 'imposta', importo: 200 });
      assert.equal(w.status, 201, JSON.stringify(w.body));
      const r1 = await get('/api/ricariche-plafond');
      assert.equal(r1.body.saldi.find((s) => s.ragioneSociale === RS_NEW).saldo, 200);
      const st = await get('/api/ricariche-plafond/storico');
      const op = st.body.storico.find((o) => o.ragioneSociale === RS_NEW);
      assert.ok(op, 'operazione della nuova RS presente nello storico');
      assert.equal(op.saldoPrima, 0);
      assert.equal(op.saldoDopo, 200);
    });

    await t.test('modulo vendite_bisuite disabilitato: tutte le route rispondono 403', async () => {
      // Le API del plafond sono gated SOLO su vendite_bisuite: un utente (anche
      // admin) di un'org con altri moduli attivi ma senza Vendite BiSuite non
      // deve leggere né modificare i dati.
      const prev = await pool.query(`SELECT enabled_modules FROM organizations WHERE id = $1`, [admin.orgId]);
      try {
        await pool.query(
          `UPDATE organizations SET enabled_modules = $2 WHERE id = $1`,
          [admin.orgId, JSON.stringify({ vendite_bisuite: false, amministrazione: true, gara_dashboard: true })],
        );
        assert.equal((await get('/api/ricariche-plafond')).status, 403);
        assert.equal((await get('/api/ricariche-plafond/storico')).status, 403);
        assert.equal((await post('/api/ricariche-plafond', { ragioneSociale: RS_A, tipo: 'aggiungi', importo: 1 })).status, 403);
      } finally {
        await pool.query(`UPDATE organizations SET enabled_modules = $2 WHERE id = $1`, [admin.orgId, prev.rows[0].enabled_modules]);
      }
    });

    await t.test('lifecycle RS: rinomina semplice, merge e delete con operazioni plafond', async () => {
      const put = (path, body, session = admin) =>
        jsonReq(`${BASE}${path}`, {
          method: 'PUT',
          headers: { Cookie: session.cookieHeader },
          body: JSON.stringify(body),
        });
      const del = (path, session = admin) =>
        jsonReq(`${BASE}${path}`, { method: 'DELETE', headers: { Cookie: session.cookieHeader } });
      const rsIdByName = async (nome) => {
        const r = await pool.query(
          `SELECT id FROM cdg_ragioni_sociali WHERE organization_id = $1 AND nome = $2`,
          [admin.orgId, nome],
        );
        return r.rows[0]?.id ?? null;
      };

      // --- Rinomina semplice: saldo e consumo seguono la RS rinominata ---
      const RS_OLD = uniq('RS PLAFOND REN').toUpperCase().replace(/_/g, ' ');
      const RS_NEW2 = `${RS_OLD} SRL`;
      assert.equal((await post('/api/ricariche-plafond', { ragioneSociale: RS_OLD, tipo: 'imposta', importo: 50 })).status, 201);
      await insertSale(pool, admin.orgId, {
        ragioneSociale: RS_OLD,
        articoli: [artRicarica('10.00')],
        dataVendita: italianWallNow(120_000),
      });
      const oldId = await rsIdByName(RS_OLD);
      assert.ok(oldId);
      const ren = await put(`/api/cdg/ragioni-sociali/${oldId}`, { nome: RS_NEW2 });
      assert.equal(ren.status, 200, JSON.stringify(ren.body));
      const r1 = await get('/api/ricariche-plafond');
      const rowNew = r1.body.saldi.find((s) => s.ragioneSociale === RS_NEW2);
      assert.ok(rowNew, 'la RS rinominata deve comparire nei saldi');
      assert.equal(rowNew.saldo, 40, 'il consumo con il vecchio nome grezzo deve seguire la RS rinominata');
      assert.equal(r1.body.saldi.find((s) => s.ragioneSociale === RS_OLD), undefined, 'nessuna riga separata col vecchio nome');
      const st1 = await get('/api/ricariche-plafond/storico');
      assert.ok(st1.body.storico.some((o) => o.ragioneSociale === RS_NEW2), 'lo storico mostra il nuovo nome');

      // --- Merge: rinomina verso una RS che ha già anchor + operazioni ---
      const RS_M1 = uniq('RS PLAFOND M1').toUpperCase().replace(/_/g, ' ');
      const RS_M2 = uniq('RS PLAFOND M2').toUpperCase().replace(/_/g, ' ');
      // RS_M1 entra nella struttura (org config) così la route di rinomina la trova.
      assert.equal((await jsonReq(`${BASE}/api/admin/struttura/ragione-sociale`, {
        method: 'POST', headers: { Cookie: admin.cookieHeader }, body: JSON.stringify({ nome: RS_M1 }),
      })).status, 201);
      assert.equal((await post('/api/ricariche-plafond', { ragioneSociale: RS_M1, tipo: 'imposta', importo: 10 })).status, 201);
      assert.equal((await post('/api/ricariche-plafond', { ragioneSociale: RS_M2, tipo: 'imposta', importo: 20 })).status, 201);
      const m1Id = await rsIdByName(RS_M1);
      const m2Id = await rsIdByName(RS_M2);
      assert.ok(m1Id && m2Id);
      const merge = await put(`/api/admin/struttura/ragione-sociale/${encodeURIComponent(RS_M1)}`, { nome: RS_M2 });
      assert.equal(merge.status, 200, JSON.stringify(merge.body));
      assert.equal(await rsIdByName(RS_M1), null, "l'anchor sorgente deve sparire dopo il merge");
      const opsM = await pool.query(
        `SELECT ragione_sociale_id FROM plafond_ricariche_ops WHERE organization_id = $1 AND ragione_sociale_id IN ($2, $3)`,
        [admin.orgId, m1Id, m2Id],
      );
      assert.equal(opsM.rows.length, 2);
      assert.ok(opsM.rows.every((r) => r.ragione_sociale_id === m2Id), 'le operazioni del sorgente sono ripuntate sul superstite');
      const r2 = await get('/api/ricariche-plafond');
      assert.equal(r2.body.saldi.filter((s) => [RS_M1, RS_M2].includes(s.ragioneSociale)).length, 1, 'una sola riga dopo il merge');

      // --- Delete: la RS con operazioni plafond si elimina senza errori FK ---
      const delRes = await del(`/api/cdg/ragioni-sociali/${m2Id}`);
      assert.equal(delRes.status, 200, JSON.stringify(delRes.body));
      const opsLeft = await pool.query(
        `SELECT 1 FROM plafond_ricariche_ops WHERE organization_id = $1 AND ragione_sociale_id = $2`,
        [admin.orgId, m2Id],
      );
      assert.equal(opsLeft.rows.length, 0, 'le operazioni della RS eliminata non restano orfane');
      const r3 = await get('/api/ricariche-plafond');
      assert.equal(r3.body.saldi.find((s) => s.ragioneSociale === RS_M2), undefined);
    });

    await t.test('rinomina/alias: saldo agganciato e consumo delle varianti sommato', async () => {
      // Task #539: dopo una rinomina (e con alias espliciti) saldo e storico
      // devono seguire la RS canonica, e il consumo delle vendite registrate
      // con QUALSIASI variante del nome deve essere sommato sulla stessa riga.
      const put = (path, body) =>
        jsonReq(`${BASE}${path}`, {
          method: 'PUT',
          headers: { Cookie: admin.cookieHeader },
          body: JSON.stringify(body),
        });
      const rsIdByName = async (nome) => {
        const r = await pool.query(
          `SELECT id FROM cdg_ragioni_sociali WHERE organization_id = $1 AND nome = $2`,
          [admin.orgId, nome],
        );
        return r.rows[0]?.id ?? null;
      };

      const RS_V = uniq('RS PLAFOND VAR').toUpperCase().replace(/_/g, ' ');
      const RS_V2 = `${RS_V} SPA`;      // nuovo nome dopo la rinomina
      const RS_V3 = `${RS_V} EVO`;      // variante unificata via alias esplicito

      // Plafond impostato PRIMA della rinomina, sul nome originale.
      const w = await post('/api/ricariche-plafond', { ragioneSociale: RS_V, tipo: 'imposta', importo: 100 });
      assert.equal(w.status, 201, JSON.stringify(w.body));
      const rsId = await rsIdByName(RS_V);
      assert.ok(rsId, 'anchor creato dalla imposta');

      // Consumo col nome originale (dopo il cutoff), poi rinomina.
      await insertSale(pool, admin.orgId, {
        ragioneSociale: RS_V, articoli: [artRicarica('10.00')], dataVendita: italianWallNow(120_000),
      });
      const ren = await put(`/api/cdg/ragioni-sociali/${rsId}`, { nome: RS_V2 });
      assert.equal(ren.status, 200, JSON.stringify(ren.body));

      // DOPO la rinomina arrivano vendite sia col vecchio nome grezzo (sync
      // BiSuite storiche/ritardatarie) sia col nuovo nome.
      await insertSale(pool, admin.orgId, {
        ragioneSociale: RS_V, articoli: [artRicarica('5.00')], dataVendita: italianWallNow(180_000),
      });
      await insertSale(pool, admin.orgId, {
        ragioneSociale: RS_V2, articoli: [artRicarica('7.00')], dataVendita: italianWallNow(180_000),
      });

      let r = await get('/api/ricariche-plafond');
      let row = r.body.saldi.find((s) => s.ragioneSociale === RS_V2);
      assert.ok(row, 'riga canonica presente dopo la rinomina');
      assert.equal(row.ragioneSocialeId, rsId, 'il saldo resta agganciato allo stesso id RS');
      assert.equal(row.consumoDaCutoff, 22, 'consumo = somma varianti vecchio+nuovo nome');
      assert.equal(row.saldo, 78);
      assert.equal(r.body.saldi.find((s) => s.ragioneSociale === RS_V), undefined,
        'nessuna riga separata per la variante vecchio nome');

      // Alias esplicito per una variante semantica: la rinomina ha già messo
      // il vecchio nome tra gli alias, la PUT li sostituisce quindi li
      // preserviamo entrambi.
      const al = await put(`/api/cdg/ragioni-sociali/${rsId}`, { alias: [RS_V, RS_V3] });
      assert.equal(al.status, 200, JSON.stringify(al.body));
      await insertSale(pool, admin.orgId, {
        ragioneSociale: RS_V3, articoli: [artRicarica('9.00')], dataVendita: italianWallNow(240_000),
      });

      r = await get('/api/ricariche-plafond');
      row = r.body.saldi.find((s) => s.ragioneSociale === RS_V2);
      assert.equal(row.consumoDaCutoff, 31, 'anche la variante alias somma sul canonico');
      assert.equal(row.saldo, 69);
      assert.equal(r.body.saldi.find((s) => s.ragioneSociale === RS_V3), undefined,
        'nessuna riga separata per la variante alias');

      // Lo storico segue il nome canonico corrente, e una nuova operazione
      // post-rinomina si aggancia allo stesso id.
      const st = await get('/api/ricariche-plafond/storico');
      const opsV = st.body.storico.filter((o) => o.ragioneSocialeId === rsId);
      assert.equal(opsV.length, 1);
      assert.equal(opsV[0].ragioneSociale, RS_V2, 'lo storico mostra il nome canonico post-rinomina');
      const w2 = await post('/api/ricariche-plafond', { ragioneSociale: RS_V2, tipo: 'aggiungi', importo: 11 });
      assert.equal(w2.status, 201, JSON.stringify(w2.body));
      assert.equal(w2.body.op.saldoPrima, 69, "l'aggiunta parte dal saldo canonico (varianti incluse)");
      assert.equal(w2.body.op.saldoDopo, 80);
      const opsDb = await pool.query(
        `SELECT count(*)::int AS c FROM plafond_ricariche_ops WHERE organization_id = $1 AND ragione_sociale_id = $2`,
        [admin.orgId, rsId],
      );
      assert.equal(opsDb.rows[0].c, 2, 'tutte le operazioni restano sullo stesso id RS');
    });

    await t.test('lastSync coerente con max(last_seen_at)', async () => {
      const db = await pool.query(
        `SELECT max(last_seen_at) AS m FROM bisuite_sales WHERE organization_id = $1`,
        [admin.orgId],
      );
      const r = await get('/api/ricariche-plafond');
      assert.equal(new Date(r.body.lastSync).getTime(), new Date(db.rows[0].m).getTime());
    });

    await t.test('UI: card plafond, controlli admin-only, ultimo aggiornamento', async () => {
      const browser = await launchBrowser();
      try {
        // Admin: card visibile con saldo e pulsanti Aggiungi/Imposta.
        const ctxAdmin = await newAuthedContext(browser, admin);
        const page = await ctxAdmin.newPage();
        await page.goto(`${BASE}/vendite-bisuite`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="card-plafond-ricariche"]', { timeout: 30000 });
        await page.waitForSelector(`[data-testid="text-plafond-saldo-${idA}"]`, { timeout: 15000 });
        const saldoText = await page.textContent(`[data-testid="text-plafond-saldo-${idA}"]`);
        assert.ok(saldoText.replace(/[\s\u00a0]/g, '').includes('125'), `saldo UI inatteso: ${saldoText}`);
        assert.ok(await page.$(`[data-testid="button-plafond-aggiungi-${idA}"]`), 'admin deve vedere Aggiungi');
        assert.ok(await page.$(`[data-testid="button-plafond-imposta-${idA}"]`), 'admin deve vedere Imposta');
        assert.ok(await page.$(`[data-testid="button-plafond-soglia-${idA}"]`), 'admin deve vedere Soglia avviso (Task #538)');
        const lastSyncEl = await page.waitForSelector('[data-testid="text-last-bisuite-sync"]', { timeout: 15000 });
        const lastSyncText = await lastSyncEl.textContent();
        assert.ok(/Ultimo aggiornamento: \d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}/.test(lastSyncText), `testo last sync inatteso: ${lastSyncText}`);
        // Storico consultabile dalla UI.
        await page.click('[data-testid="button-plafond-storico"]');
        await page.waitForSelector('[data-testid="list-plafond-storico"]', { timeout: 15000 });
        await ctxAdmin.close();

        // Operatore (con addetto pertinente): saldo visibile, nessun controllo
        // di modifica.
        await setRole(pool, admin.profileId, 'operatore');
        await pool.query(`UPDATE profiles SET bisuite_addetti = ARRAY['ADDETTO TEST'] WHERE id = $1`, [admin.profileId]);
        try {
          const ctxOp = await newAuthedContext(browser, admin);
          const pageOp = await ctxOp.newPage();
          await pageOp.goto(`${BASE}/vendite-bisuite`, { waitUntil: 'domcontentloaded' });
          await pageOp.waitForSelector(`[data-testid="text-plafond-saldo-${idA}"]`, { timeout: 30000 });
          assert.equal(await pageOp.$(`[data-testid="button-plafond-aggiungi-${idA}"]`), null, 'operatore NON deve vedere Aggiungi');
          assert.equal(await pageOp.$(`[data-testid="button-plafond-imposta-${idA}"]`), null, 'operatore NON deve vedere Imposta');
          assert.equal(await pageOp.$(`[data-testid="button-plafond-soglia-${idA}"]`), null, 'operatore NON deve vedere Soglia avviso');
          await ctxOp.close();
        } finally {
          await setRole(pool, admin.profileId, 'admin');
        }
      } finally {
        await browser.close();
      }
    });
  } finally {
    await cleanupOrg(pool, admin);
    await cleanupOrg(pool, other);
    await pool.end();
  }
});

// Task #544 — Plafond per CODICE DEALER ("8 miliardi").
//
// Copre:
//  - più POS dello stesso dealer consumano lo stesso plafond;
//  - dealer diversi della stessa RS hanno saldi e soglie separati;
//  - PDV senza dealer segnalato (senzaDealer), mai attribuito a un dealer;
//  - operazioni per codiceDealer (imposta/aggiungi/cutoff);
//  - op legacy per RS: auto-attribuzione con dealer unico, "da assegnare"
//    con più dealer + endpoint /assegna senza duplicazioni;
//  - import bulk Struttura: aggiorna il codiceDealer dei POS esistenti;
//  - operatore scoped ai dealer dei propri addetti;
//  - UI: righe dealer, badge senza-dealer/da-assegnare.
test('plafond ricariche per codice dealer', async (t) => {
  const pool = await newPool();
  const admin = await signup({ prefix: 'dealer_admin', fullName: 'Dealer Admin' });
  const RS = uniq('RS CMS').toUpperCase().replace(/_/g, ' ');
  const D1 = '8000111001';
  const D2 = '8000111002';
  const P_A1 = uniq('9A1').toUpperCase();
  const P_A2 = uniq('9A2').toUpperCase();
  const P_B1 = uniq('9B1').toUpperCase();
  const P_C1 = uniq('9C1').toUpperCase();

  const get = (path) => jsonReq(`${BASE}${path}`, { headers: { Cookie: admin.cookieHeader } });
  const post = (path, body) =>
    jsonReq(`${BASE}${path}`, { method: 'POST', headers: { Cookie: admin.cookieHeader }, body: JSON.stringify(body) });

  const dealerRow = (saldi, codice) => saldi.find((s) => s.codiceDealer === codice);

  try {
    // Struttura: A1+A2 → D1, B1 → D2 (stessa RS), C1 senza dealer.
    for (const [codicePos, nome, codiceDealer] of [
      [P_A1, 'PDV A1', D1], [P_A2, 'PDV A2', D1], [P_B1, 'PDV B1', D2], [P_C1, 'PDV C1', ''],
    ]) {
      const r = await post('/api/admin/struttura/pdv', { codicePos, nome, ragioneSociale: RS, codiceDealer });
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }

    // Vendite ricariche: D1 = 10+20 (due POS), D2 = 5, C1 (senza dealer) = 7.
    await insertSale(pool, admin.orgId, { ragioneSociale: RS, articoli: [artRicarica('10.00')], codicePos: P_A1, addetto: 'ADDETTO A' });
    await insertSale(pool, admin.orgId, { ragioneSociale: RS, articoli: [artRicarica('20.00')], codicePos: P_A2, addetto: 'ADDETTO A' });
    await insertSale(pool, admin.orgId, { ragioneSociale: RS, articoli: [artRicarica('5.00')], codicePos: P_B1, addetto: 'ADDETTO B' });
    await insertSale(pool, admin.orgId, { ragioneSociale: RS, articoli: [artRicarica('7.00')], codicePos: P_C1, addetto: 'ADDETTO C' });

    await t.test('consumo raggruppato per dealer; PDV senza dealer segnalato', async () => {
      const r = await get('/api/ricariche-plafond');
      assert.equal(r.status, 200);
      const d1 = dealerRow(r.body.saldi, D1);
      const d2 = dealerRow(r.body.saldi, D2);
      assert.ok(d1 && d2, JSON.stringify(r.body.saldi));
      assert.equal(d1.consumoTotale, 30, 'due POS dello stesso dealer sommano sullo stesso plafond');
      assert.equal(d1.pdv.length, 2);
      assert.equal(d2.consumoTotale, 5, 'dealer diverso della stessa RS resta separato');
      assert.equal(d1.saldo, null);
      // Il PDV senza dealer NON confluisce in nessun dealer: riga RS segnalata.
      const senza = r.body.saldi.find((s) => !s.codiceDealer && s.ragioneSociale === RS);
      assert.ok(senza, 'riga per il consumo dei PDV senza dealer');
      assert.equal(senza.senzaDealer, true);
      assert.equal(senza.consumoTotale, 7);
      assert.equal(d1.consumoTotale + d2.consumoTotale + senza.consumoTotale, 42, 'nessun consumo perso o duplicato');
    });

    await t.test('operazioni per codiceDealer: imposta con cutoff, aggiungi, saldi separati', async () => {
      const w = await post('/api/ricariche-plafond', { codiceDealer: D1, tipo: 'imposta', importo: 100 });
      assert.equal(w.status, 201, JSON.stringify(w.body));
      assert.equal(w.body.codiceDealer, D1);
      // Vendita post-cutoff su ALTRO POS dello stesso dealer: decurta lo stesso saldo.
      await insertSale(pool, admin.orgId, {
        ragioneSociale: RS, articoli: [artRicarica('25.00')], codicePos: P_A2,
        dataVendita: italianWallNow(120_000), addetto: 'ADDETTO A',
      });
      let r = await get('/api/ricariche-plafond');
      assert.equal(dealerRow(r.body.saldi, D1).saldo, 75);
      assert.equal(dealerRow(r.body.saldi, D2).saldo, null, "l'operazione su D1 non configura D2");

      assert.equal((await post('/api/ricariche-plafond', { codiceDealer: D2, tipo: 'imposta', importo: 40 })).status, 201);
      assert.equal((await post('/api/ricariche-plafond', { codiceDealer: D1, tipo: 'aggiungi', importo: 10 })).status, 201);
      r = await get('/api/ricariche-plafond');
      assert.equal(dealerRow(r.body.saldi, D1).saldo, 85);
      assert.equal(dealerRow(r.body.saldi, D2).saldo, 40);

      // Dealer sconosciuto rifiutato.
      assert.equal((await post('/api/ricariche-plafond', { codiceDealer: '8999999999', tipo: 'imposta', importo: 1 })).status, 400);

      // Lo storico espone il codice dealer.
      const st = await get('/api/ricariche-plafond/storico');
      assert.ok(st.body.storico.some((o) => o.codiceDealer === D1 && o.tipo === 'imposta'));
    });

    await t.test('op legacy per RS: con più dealer è "da assegnare", /assegna ripunta senza duplicare', async () => {
      // Op storica per RS (codice_dealer NULL) su una RS che ha DUE dealer.
      const anchor = await pool.query(
        `INSERT INTO cdg_ragioni_sociali (organization_id, nome, origine) VALUES ($1, $2, 'auto')
         ON CONFLICT (organization_id, nome) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`,
        [admin.orgId, RS],
      );
      const rsId = anchor.rows[0].id;
      await pool.query(
        `INSERT INTO plafond_ricariche_ops (organization_id, ragione_sociale_id, tipo, importo, saldo_prima, saldo_dopo)
         VALUES ($1, $2, 'aggiungi', 15, 0, 15)`,
        [admin.orgId, rsId],
      );
      let r = await get('/api/ricariche-plafond');
      const pending = r.body.saldi.find((s) => !s.codiceDealer && s.ragioneSociale === RS);
      assert.ok(pending, 'riga RS legacy presente');
      assert.equal(pending.daAssegnare, true, 'RS con più dealer: operazione da assegnare');
      const saldoD1Prima = dealerRow(r.body.saldi, D1).saldo;

      // Assegnazione esplicita a D1: stesse righe ripuntate, nessuna duplicazione.
      const a = await post('/api/ricariche-plafond/assegna', { ragioneSociale: RS, codiceDealer: D1 });
      assert.equal(a.status, 200, JSON.stringify(a.body));
      assert.equal(a.body.assegnate, 1);
      r = await get('/api/ricariche-plafond');
      assert.equal(dealerRow(r.body.saldi, D1).saldo, saldoD1Prima + 15, "l'importo confluisce UNA volta nel dealer");
      const stillPending = r.body.saldi.find((s) => !s.codiceDealer && s.ragioneSociale === RS && s.daAssegnare);
      assert.equal(stillPending, undefined, 'nessuna riga residua da assegnare');
      // Le op registrate col dealer conservano comunque la RS descrittiva:
      // per verificare la non-duplicazione contiamo la SOLA op legacy (15€).
      const cnt = await pool.query(
        `SELECT count(*)::int AS c, count(*) FILTER (WHERE codice_dealer IS NULL)::int AS pending
         FROM plafond_ricariche_ops
         WHERE organization_id = $1 AND ragione_sociale_id = $2 AND tipo = 'aggiungi' AND importo = 15`,
        [admin.orgId, rsId],
      );
      assert.equal(cnt.rows[0].c, 1, 'nessuna operazione duplicata');
      assert.equal(cnt.rows[0].pending, 0, 'la riga legacy è stata ripuntata, non copiata');
      // Ri-assegnare senza op pendenti fallisce (404), non duplica.
      assert.equal((await post('/api/ricariche-plafond/assegna', { ragioneSociale: RS, codiceDealer: D2 })).status, 404);
    });

    await t.test('op legacy per RS con dealer UNICO: registrata direttamente sul dealer', async () => {
      const RS_U = uniq('RS UNICO').toUpperCase().replace(/_/g, ' ');
      const D3 = '8000111003';
      const P_U = uniq('9U1').toUpperCase();
      assert.equal((await post('/api/admin/struttura/pdv', { codicePos: P_U, nome: 'PDV U', ragioneSociale: RS_U, codiceDealer: D3 })).status, 201);
      // Guard contabile: un'op storica di RS_U NON può essere assegnata a un
      // dealer di un'altra RS (D1 appartiene a RS, non a RS_U).
      const cross = await post('/api/ricariche-plafond/assegna', { ragioneSociale: RS_U, codiceDealer: D1 });
      assert.equal(cross.status, 400, JSON.stringify(cross.body));
      const w = await post('/api/ricariche-plafond', { ragioneSociale: RS_U, tipo: 'imposta', importo: 60 });
      assert.equal(w.status, 201, JSON.stringify(w.body));
      assert.equal(w.body.codiceDealer, D3, 'RS con un solo dealer: op migrata sul dealer');
      const r = await get('/api/ricariche-plafond');
      assert.equal(dealerRow(r.body.saldi, D3).saldo, 60);
    });

    await t.test('bulk Struttura: aggiorna il codiceDealer dei POS esistenti', async () => {
      const D4 = '8000111004';
      const b = await post('/api/admin/struttura/pdv/bulk', {
        pdvs: [
          { codicePos: P_C1, nome: 'PDV C1', ragioneSociale: RS, codiceDealer: D4 },   // esistente: update dealer
          { codicePos: P_B1, nome: 'PDV B1', ragioneSociale: RS, codiceDealer: D2 },   // esistente: dealer invariato
          { codicePos: uniq('9N1').toUpperCase(), nome: 'PDV N1', ragioneSociale: RS, codiceDealer: D4 }, // nuovo
        ],
      });
      assert.equal(b.status, 200, JSON.stringify(b.body));
      assert.equal(b.body.updated.length, 1);
      assert.equal(b.body.added.length, 1);
      assert.equal(b.body.skipped.length, 1);
      const r = await get('/api/ricariche-plafond');
      const d4 = dealerRow(r.body.saldi, D4);
      assert.ok(d4, 'il nuovo dealer compare nei saldi');
      assert.equal(d4.consumoTotale, 7, 'il consumo del POS ex-senza-dealer segue il dealer assegnato');
      assert.equal(r.body.saldi.find((s) => !s.codiceDealer && s.senzaDealer && s.ragioneSociale === RS), undefined,
        'nessuna riga senza-dealer residua dopo l\'assegnazione');
    });

    await t.test('operatore: vede solo i dealer dei propri addetti', async () => {
      await setRole(pool, admin.profileId, 'operatore');
      try {
        await pool.query(`UPDATE profiles SET bisuite_addetti = ARRAY['ADDETTO A'] WHERE id = $1`, [admin.profileId]);
        const r = await get('/api/ricariche-plafond');
        assert.ok(dealerRow(r.body.saldi, D1), 'vede il dealer dei suoi POS');
        assert.equal(dealerRow(r.body.saldi, D2), undefined, 'NON vede il dealer di altri addetti');
        const st = await get('/api/ricariche-plafond/storico');
        assert.ok(st.body.storico.length > 0);
        assert.ok(st.body.storico.every((o) => o.codiceDealer === D1), `storico fuori perimetro: ${JSON.stringify(st.body.storico)}`);
        // Modifica sempre vietata.
        assert.equal((await post('/api/ricariche-plafond', { codiceDealer: D1, tipo: 'aggiungi', importo: 1 })).status, 403);
        assert.equal((await post('/api/ricariche-plafond/assegna', { ragioneSociale: RS, codiceDealer: D1 })).status, 403);
      } finally {
        await pool.query(`UPDATE profiles SET bisuite_addetti = ARRAY[]::text[] WHERE id = $1`, [admin.profileId]);
        await setRole(pool, admin.profileId, 'admin');
      }
    });

    await t.test('UI: righe per dealer con saldo e controlli admin', async () => {
      const browser = await launchBrowser();
      try {
        const ctx = await newAuthedContext(browser, admin);
        const page = await ctx.newPage();
        await page.goto(`${BASE}/vendite-bisuite`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="card-plafond-ricariche"]', { timeout: 30000 });
        const idD1 = slug(D1);
        await page.waitForSelector(`[data-testid="text-plafond-saldo-${idD1}"]`, { timeout: 15000 });
        const rowText = await page.textContent(`[data-testid="row-plafond-${idD1}"]`);
        assert.ok(rowText.includes(`Dealer ${D1}`), `riga dealer mancante: ${rowText}`);
        assert.ok(rowText.includes(RS), 'la riga dealer mostra la RS descrittiva');
        assert.ok(await page.$(`[data-testid="button-plafond-aggiungi-${idD1}"]`), 'admin vede Aggiungi sul dealer');
        assert.ok(await page.$(`[data-testid="button-plafond-imposta-${idD1}"]`), 'admin vede Imposta sul dealer');
        await ctx.close();
      } finally {
        await browser.close();
      }
    });
  } finally {
    await cleanupOrg(pool, admin);
    await pool.end();
  }
});
