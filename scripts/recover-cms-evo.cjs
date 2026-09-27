// One-off, targeted recovery from the 2026-09-21 pre-deletion PostgreSQL backup
// restored as scratch_tuscolana_recovery on the production VPS.
// By default rolls back; pass --apply only after reviewing the dry-run summary.
const fs = require("node:fs");
const { Client } = require("pg");

const orgId = "org-admin-windtre";
const rsName = "CMS Evo S.R.L";
const pos = "9001212651";
const rsId = "fe1e56b9-1886-4501-a55c-d6e2f56babd9";
const apply = process.argv.includes("--apply") || process.env.APPLY === "1";
const raw = fs.readFileSync("/var/www/incentive-w3/ecosystem.config.cjs", "utf8");
const match = raw.match(/DATABASE_URL\s*:\s*['"]([^'"]+)['"]/);
if (!match) throw new Error("Production database configuration unavailable");
const liveUrl = new URL(match[1]);
const backupUrl = new URL(match[1]);
backupUrl.pathname = "/scratch_tuscolana_recovery";
const live = new Client({ connectionString: liveUrl.toString() });
const backup = new Client({ connectionString: backupUrl.toString() });

async function insertRow(table, row) {
  const names = Object.keys(row);
  if (names.some(name => !/^[a-z_][a-z0-9_]*$/.test(name))) throw new Error("Unexpected column name");
  await live.query(
    `INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT (id) DO NOTHING`,
    names.map(name => row[name]),
  );
}

async function main() {
  await backup.connect();
  await live.connect();
  try {
    await backup.query("BEGIN READ ONLY");
    await live.query("BEGIN");
    const beforeRs = (await backup.query(
      "SELECT * FROM cdg_ragioni_sociali WHERE id=$1 AND organization_id=$2 AND nome=$3",
      [rsId, orgId, rsName],
    )).rows[0];
    if (!beforeRs) throw new Error("Expected RS absent in backup");
    const config = (await live.query("SELECT config FROM organization_config WHERE organization_id=$1 FOR UPDATE", [orgId])).rows[0]?.config;
    if (!config || !Array.isArray(config.puntiVendita)) throw new Error("Current structure unavailable");
    if (config.puntiVendita.some(p => p.codicePos === pos)) throw new Error("PDV already restored: refusing duplicate");
    const snapshot = (await live.query(
      "SELECT punti_vendita,ragioni_sociali FROM organization_config_history WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 1",
      [orgId],
    )).rows[0];
    const oldPdv = snapshot?.punti_vendita?.find(p => p.codicePos === pos && p.ragioneSociale === rsName);
    if (!oldPdv || !oldPdv.brandIds?.length) throw new Error("Historic branded PDV not found");
    if ((await live.query("SELECT 1 FROM cdg_ragioni_sociali WHERE organization_id=$1 AND (id=$2 OR nome=$3)", [orgId, rsId, rsName])).rowCount) {
      throw new Error("RS already exists: refusing to overwrite");
    }
    const oldSpese = (await backup.query(
      "SELECT * FROM cdg_spese WHERE organization_id=$1 AND (ragione_sociale_id=$2 OR ragione_sociale=$3)",
      [orgId, rsId, rsName],
    )).rows;
    if (oldSpese.length !== 531) throw new Error(`Unexpected backup expense count: ${oldSpese.length}`);
    const oldIds = oldSpese.map(s => s.id);
    if ((await live.query("SELECT count(*)::int n FROM cdg_spese WHERE id=ANY($1::varchar[])", [oldIds])).rows[0].n) {
      throw new Error("Some expenses already exist: investigate before recovery");
    }
    const oldEntries = {};
    for (const table of ["cdg_categorie", "cdg_fornitori"]) {
      oldEntries[table] = (await backup.query(
        `SELECT * FROM ${table} WHERE organization_id=$1 AND ($2=ANY(ragione_sociale_ids) OR $3=ANY(ragioni_sociali))`,
        [orgId, rsId, rsName],
      )).rows;
    }
    // Archive the current structure; only merge the missing RS and PDV.
    await live.query(
      "INSERT INTO organization_config_history (organization_id,punti_vendita,ragioni_sociali,config_version) SELECT organization_id,config->'puntiVendita',config->'ragioniSociali',config_version FROM organization_config WHERE organization_id=$1",
      [orgId],
    );
    const next = {
      ...config,
      puntiVendita: [...config.puntiVendita, oldPdv],
      ragioniSociali: [...new Set([...(Array.isArray(config.ragioniSociali) ? config.ragioniSociali : []), rsName])],
    };
    await live.query("UPDATE organization_config SET config=$2::jsonb,updated_at=now() WHERE organization_id=$1", [orgId, JSON.stringify(next)]);
    await insertRow("cdg_ragioni_sociali", beforeRs);
    const restored = {};
    for (const table of ["cdg_categorie", "cdg_fornitori"]) {
      restored[table] = { created: 0, relinked: 0 };
      for (const old of oldEntries[table]) {
        const current = (await live.query(`SELECT id FROM ${table} WHERE id=$1 AND organization_id=$2`, [old.id, orgId])).rows[0];
        if (current) {
          // Restore only the lost CMS Evo association. Do not overwrite any edits since the backup.
          await live.query(
            `UPDATE ${table} SET ragioni_sociali = CASE WHEN $2=ANY(ragioni_sociali) THEN ragioni_sociali ELSE array_append(ragioni_sociali,$2) END,
              ragione_sociale_ids = CASE WHEN $3=ANY(ragione_sociale_ids) THEN ragione_sociale_ids ELSE array_append(ragione_sociale_ids,$3) END
              WHERE id=$1 AND organization_id=$4`,
            [old.id, rsName, rsId, orgId],
          );
          restored[table].relinked++;
        } else {
          await insertRow(table, old);
          restored[table].created++;
        }
      }
    }
    for (const row of oldSpese) await insertRow("cdg_spese", row);
    const counts = {};
    for (const table of ["cdg_spese", "cdg_categorie", "cdg_fornitori"]) {
      const clause = table === "cdg_spese" ? "ragione_sociale_id=$2" : "$2=ANY(ragione_sociale_ids)";
      counts[table] = (await live.query(`SELECT count(*)::int n FROM ${table} WHERE organization_id=$1 AND ${clause}`, [orgId, rsId])).rows[0].n;
    }
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", restored, counts, pdv: pos, rs: rsName }));
    if (counts.cdg_spese !== 531 || counts.cdg_categorie < 18 || counts.cdg_fornitori < 76) {
      throw new Error("Post-restore count mismatch");
    }
    await live.query(apply ? "COMMIT" : "ROLLBACK");
    await backup.query("ROLLBACK");
  } catch (error) {
    await live.query("ROLLBACK").catch(() => {});
    await backup.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await live.end();
    await backup.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });