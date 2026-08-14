// Task #367 — Unificazione varianti Ragione Sociale (alias).
//
// Verifica sul VERO percorso server (API + dev DB):
//   1. varianti "banali" (punti/spazi/case: "CMS SRL" vs "CMS S.R.L") vengono
//      unificate automaticamente sul nome canonico del registro RS in
//      GET /api/bisuite-sales;
//   2. varianti semantiche ("CMS Evo S.R.L") vengono unificate solo con un
//      alias esplicito sulla RS canonica, e ri-separate quando l'alias
//      viene rimosso (risoluzione SOLO in lettura, dati storici intatti);
//   3. anche le spese CdG registrate sotto una variante vengono mostrate col
//      nome canonico e incluse nel filtro rs= della RS canonica;
//   4. un alias che collide con un'altra RS manuale o con l'alias di
//      un'altra RS viene rifiutato (400);
//   5. l'endpoint alias-impact conta vendite e spese per nome normalizzato.
//
// Esecuzione: node --test tests/rs-alias.test.mjs (server su :5000, DATABASE_URL set)

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE, uniq, jsonReq, signup, newPool, setRole, cleanupOrg,
} from './helpers/uiTest.mjs';

const api = (session, method, path, body) =>
  jsonReq(`${BASE}${path}`, {
    method,
    headers: { Cookie: session.cookieHeader },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const DATA_VENDITA = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-10T10:00:00.000Z`;
const DATA_PAG = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-10`;

async function insertSale(pool, orgId, ragioneSociale) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio, ragione_sociale, stato, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [orgId, bisuiteId, DATA_VENDITA, 'POS-1', 'Negozio Test', ragioneSociale, 'ATTIVO', JSON.stringify({ articoli: [] })],
  );
}

async function fetchSalesRs(session) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const r = await api(session, 'GET', `/api/bisuite-sales?year=${y}&month=${m}`);
  assert.equal(r.status, 200, `bisuite-sales: ${JSON.stringify(r.body)}`);
  return (r.body.sales || []).map((s) => s.ragioneSociale).sort();
}

test('RS alias: unificazione automatica + alias espliciti in vendite e spese', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'rs_alias', fullName: 'RS Alias Test' });
  try {
    await setRole(pool, session.profileId, 'admin');
    const tag = uniq('CMS').toUpperCase(); // es. CMS_ab12cd34 — evita collisioni
    const canonico = `${tag} Evolution Srl`;
    const varBanale = `${tag}  EVOLUTION S.R.L`; // punti + doppio spazio + case
    const variante = `${tag} Evo S.R.L`; // richiede alias esplicito

    // Vendite: una per ciascun nome.
    await insertSale(pool, session.orgId, canonico);
    await insertSale(pool, session.orgId, varBanale);
    await insertSale(pool, session.orgId, variante);

    // 1) Registro con la sola RS canonica: la variante banale si unifica
    //    da sola, quella semantica resta separata.
    const cr = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: canonico });
    assert.equal(cr.status, 201, JSON.stringify(cr.body));
    const rsId = cr.body.id;

    let names = await fetchSalesRs(session);
    assert.deepEqual(names, [canonico, canonico, variante].sort());

    // 2) alias-impact sulla variante: 1 vendita, 0 spese.
    const imp = await api(session, 'GET', `/api/cdg/ragioni-sociali/alias-impact?nome=${encodeURIComponent(variante)}`);
    assert.equal(imp.status, 200, JSON.stringify(imp.body));
    assert.equal(imp.body.vendite, 1);
    assert.equal(imp.body.spese, 0);

    // 3) Aggiungo l'alias: tutte e tre le vendite diventano canoniche.
    const up = await api(session, 'PUT', `/api/cdg/ragioni-sociali/${rsId}`, { alias: [variante] });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    names = await fetchSalesRs(session);
    assert.deepEqual(names, [canonico, canonico, canonico].sort());

    // Storico intatto: sul DB i nomi originali NON sono stati riscritti.
    const raw = await pool.query(
      `SELECT ragione_sociale FROM bisuite_sales WHERE organization_id = $1 ORDER BY ragione_sociale`,
      [session.orgId],
    );
    assert.deepEqual(raw.rows.map((r) => r.ragione_sociale).sort(), [canonico, varBanale, variante].sort());

    // 4) Spese: una spesa creata sotto la variante (anchor auto) viene
    //    mostrata come canonica e inclusa nel filtro rs=canonico.
    const sp = await api(session, 'POST', '/api/cdg/spese', {
      ragioneSociale: variante,
      descrizione: 'Spesa variante',
      imponibile: '100.00',
      aliquotaIva: '22.00',
      iva: '22.00',
      totale: '122.00',
      dataPagamento: DATA_PAG,
      meseCompetenza: DATA_PAG.slice(0, 7),
    });
    assert.equal(sp.status, 201, JSON.stringify(sp.body));
    const speseList = await api(session, 'GET', `/api/cdg/spese?rs=${encodeURIComponent(canonico)}`);
    assert.equal(speseList.status, 200);
    const mie = (speseList.body || []).filter((s) => s.descrizione === 'Spesa variante');
    assert.equal(mie.length, 1, `spesa variante non inclusa nel filtro canonico: ${JSON.stringify(speseList.body)}`);
    assert.equal(mie[0].ragioneSociale, canonico);

    // alias-impact ora conta anche la spesa.
    const imp2 = await api(session, 'GET', `/api/cdg/ragioni-sociali/alias-impact?nome=${encodeURIComponent(variante)}`);
    assert.equal(imp2.body.spese, 1);

    // 5) Rimuovo l'alias: la vendita della variante si ri-separa.
    const clr = await api(session, 'PUT', `/api/cdg/ragioni-sociali/${rsId}`, { alias: [] });
    assert.equal(clr.status, 200, JSON.stringify(clr.body));
    names = await fetchSalesRs(session);
    assert.deepEqual(names, [canonico, canonico, variante].sort());

    // 6) Collisioni: alias = nome di un'altra RS manuale → 400;
    //    alias già assegnato a un'altra RS → 400.
    const altra = `${tag} Retail Srl`;
    const cr2 = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: altra });
    assert.equal(cr2.status, 201);
    const bad1 = await api(session, 'PUT', `/api/cdg/ragioni-sociali/${rsId}`, { alias: [`${tag} RETAIL S.R.L`] });
    assert.equal(bad1.status, 400, `attesa collisione con RS manuale: ${JSON.stringify(bad1.body)}`);
    const ok = await api(session, 'PUT', `/api/cdg/ragioni-sociali/${rsId}`, { alias: [variante] });
    assert.equal(ok.status, 200);
    const bad2 = await api(session, 'PUT', `/api/cdg/ragioni-sociali/${cr2.body.id}`, { alias: [variante.toLowerCase()] });
    assert.equal(bad2.status, 400, `atteso alias già assegnato: ${JSON.stringify(bad2.body)}`);

    // 7) POST con alias: gli alias vengono persistiti alla creazione.
    const conAlias = `${tag} Nuova Srl`;
    const aliasNuova = `${tag} Nuovissima S.R.L`;
    const cr3 = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: conAlias, alias: [aliasNuova] });
    assert.equal(cr3.status, 201, JSON.stringify(cr3.body));
    assert.deepEqual(cr3.body.alias, [aliasNuova]);
    const lista = await api(session, 'GET', '/api/cdg/ragioni-sociali/unified');
    const row3 = (lista.body || []).find((r) => r.nome === conAlias);
    assert.deepEqual(row3?.alias, [aliasNuova], `alias non persistito: ${JSON.stringify(row3)}`);

    // 8) Un nome nuovo/rinominato non può coincidere con l'alias di un'altra RS.
    const bad3 = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: aliasNuova.toLowerCase() });
    assert.equal(bad3.status, 409, `atteso 409 nome=alias altrui: ${JSON.stringify(bad3.body)}`);
    const bad4 = await api(session, 'PUT', `/api/cdg/ragioni-sociali/${cr2.body.id}`, { nome: `${tag} NUOVISSIMA SRL` });
    assert.equal(bad4.status, 409, `atteso 409 rename su alias altrui: ${JSON.stringify(bad4.body)}`);

    // 9) RS ereditata (solo puntiVendita, NESSUN anchor nel registro):
    //    la route inherited deve persistere gli alias creando l'anchor
    //    anche con P.IVA/note vuote.
    const eredita = `${tag} Stores Srl`;
    const aliasEredita = `${tag} Store S.R.L`;
    await pool.query(
      `INSERT INTO organization_config (organization_id, config, config_version)
         VALUES ($1, jsonb_build_object('puntiVendita', jsonb_build_array(
           jsonb_build_object('nome', 'PDV Test', 'codicePos', 'POS-9', 'ragioneSociale', $2::text))), '2.0')
       ON CONFLICT (organization_id) DO UPDATE
         SET config = COALESCE(organization_config.config, '{}'::jsonb)
             || jsonb_build_object('puntiVendita', jsonb_build_array(
                  jsonb_build_object('nome', 'PDV Test', 'codicePos', 'POS-9', 'ragioneSociale', $2::text)))`,
      [session.orgId, eredita],
    );
    await insertSale(pool, session.orgId, aliasEredita);
    const inh = await api(session, 'PUT', `/api/cdg/ragioni-sociali/inherited/${encodeURIComponent(eredita)}`, {
      nome: eredita, partitaIva: null, note: null, alias: [aliasEredita],
    });
    assert.equal(inh.status, 200, JSON.stringify(inh.body));
    const unified2 = await api(session, 'GET', '/api/cdg/ragioni-sociali/unified');
    const rowInh = (unified2.body || []).find((r) => r.nome === eredita);
    assert.deepEqual(rowInh?.alias, [aliasEredita], `alias ereditata non persistito: ${JSON.stringify(rowInh)}`);
    names = await fetchSalesRs(session);
    assert.ok(names.includes(eredita) && !names.includes(aliasEredita),
      `vendita variante ereditata non canonicalizzata: ${names}`);

    // 9-bis) Atomicità: rename + alias in conflitto nella STESSA richiesta →
    //        errore senza applicare NULLA (né puntiVendita né registro).
    const inhBad = await api(session, 'PUT', `/api/cdg/ragioni-sociali/inherited/${encodeURIComponent(eredita)}`, {
      nome: `${tag} Stores Rinominata Srl`, partitaIva: null, note: null, alias: [altra], // altra = RS manuale
    });
    assert.equal(inhBad.status, 400, `atteso 400 alias in conflitto: ${JSON.stringify(inhBad.body)}`);
    const cfgAfter = await pool.query(
      `SELECT config->'puntiVendita' AS pv FROM organization_config WHERE organization_id = $1`,
      [session.orgId],
    );
    const pvNames = (cfgAfter.rows[0]?.pv || []).map((p) => p.ragioneSociale);
    assert.ok(pvNames.includes(eredita), `puntiVendita rinominata nonostante il 400: ${pvNames}`);
    const regAfter = await pool.query(
      `SELECT nome FROM cdg_ragioni_sociali WHERE organization_id = $1 AND nome = $2`,
      [session.orgId, `${tag} Stores Rinominata Srl`],
    );
    assert.equal(regAfter.rowCount, 0, 'registro rinominato nonostante il 400');

    // 10) Dashboard/mapped-sales: anche l'aggregato mappato usa i nomi canonici.
    const y = now.getFullYear(); const m = now.getMonth() + 1;
    const mapped = await api(session, 'GET', `/api/admin/bisuite-mapped-sales?year=${y}&month=${m}`);
    assert.equal(mapped.status, 200, JSON.stringify(mapped.body));
    const rsInMapped = new Set((mapped.body.pdvList || []).map((p) => p.ragioneSociale).filter(Boolean));
    assert.ok(!rsInMapped.has(variante), `la variante non deve comparire nei mapped-sales: ${[...rsInMapped]}`);
  } finally {
    await pool.query(`DELETE FROM bisuite_sales WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await cleanupOrg(pool, session).catch(() => {});
    await pool.end();
  }
});
