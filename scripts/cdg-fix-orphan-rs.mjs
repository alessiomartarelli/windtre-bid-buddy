#!/usr/bin/env node
// Bonifica una-tantum (Task RS obsolete): rimuove dalle voci CdG
// (categorie/fornitori) i nomi di Ragioni Sociali che non esistono più
// nella lista valida dell'organizzazione (RS manuali + RS dei PDV in
// organization_config.puntiVendita). Le voci che resterebbero senza
// alcuna RS valida NON vengono toccate (segnalate a video).
//
// Uso:
//   node scripts/cdg-fix-orphan-rs.mjs           # dry-run (default)
//   node scripts/cdg-fix-orphan-rs.mjs --apply   # applica le modifiche
//   DATABASE_URL=... node scripts/cdg-fix-orphan-rs.mjs --apply  # es. prod via tunnel
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const orgs = new Set();
for (const t of ["cdg_categorie", "cdg_fornitori", "cdg_spese", "cdg_pdv_manuali"]) {
  const r = await pool.query(`SELECT DISTINCT organization_id FROM ${t}`);
  for (const row of r.rows) orgs.add(row.organization_id);
}

let touched = 0;
for (const orgId of orgs) {
  const manuali = await pool.query(`SELECT nome FROM cdg_ragioni_sociali WHERE organization_id = $1`, [orgId]);
  const cfg = await pool.query(`SELECT config->'puntiVendita' AS pv FROM organization_config WHERE organization_id = $1`, [orgId]);
  const valid = new Set(manuali.rows.map(r => r.nome));
  for (const p of (cfg.rows[0]?.pv ?? [])) {
    const n = String(p?.ragioneSociale || "").trim();
    if (n) valid.add(n);
  }

  for (const t of ["cdg_categorie", "cdg_fornitori"]) {
    const rows = await pool.query(`SELECT id, nome, ragioni_sociali FROM ${t} WHERE organization_id = $1`, [orgId]);
    for (const row of rows.rows) {
      const arr = row.ragioni_sociali || [];
      const orphans = arr.filter(n => !valid.has(n));
      if (orphans.length === 0) continue;
      const keep = arr.filter(n => valid.has(n));
      if (keep.length === 0) {
        console.log(`[SKIP] ${t} "${row.nome}" (org ${orgId}): tutte le RS sono orfane ${JSON.stringify(orphans)} — da sistemare a mano`);
        continue;
      }
      touched++;
      console.log(`[${APPLY ? "FIX" : "DRY"}] ${t} "${row.nome}" (org ${orgId}): rimuovo ${JSON.stringify(orphans)} → resta ${JSON.stringify(keep)}`);
      if (APPLY) {
        await pool.query(`UPDATE ${t} SET ragioni_sociali = $1 WHERE id = $2`, [keep, row.id]);
      }
    }
  }

  // Solo report (non tocchiamo spese/pdv manuali: la RS è chiave di partizione)
  for (const t of ["cdg_spese", "cdg_pdv_manuali"]) {
    const rows = await pool.query(
      `SELECT DISTINCT ragione_sociale FROM ${t} WHERE organization_id = $1`, [orgId]);
    for (const row of rows.rows) {
      if (row.ragione_sociale && !valid.has(row.ragione_sociale)) {
        console.log(`[WARN] ${t} (org ${orgId}): RS orfana "${row.ragione_sociale}" — non toccata, valutare rinomina manuale`);
      }
    }
  }
}

console.log(`${APPLY ? "Applicate" : "Da applicare (dry-run)"}: ${touched} voci.`);
await pool.end();
