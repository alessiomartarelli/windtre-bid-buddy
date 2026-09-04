/**
 * Verifica post-deploy degli "acquisti successivi" Customer Journey su dati
 * reali: esegue lo STESSO reconcile del percorso schedulato
 * (storage.reconcileCustomerJourneys) per l'org indicata e stampa i conteggi
 * delle vendite senza identità, poi mostra alcune journey di luglio che hanno
 * item inseriti nei mesi successivi (acquisto successivo agganciato).
 *
 * Da lanciare con DATABASE_URL puntato al DB di PROD (tunnel SSH).
 * Read-mostly: il reconcile è upsert-only e idempotente. Non stampa segreti.
 */
import { storage } from "../server/storage";
import { pool } from "../server/db";

async function main() {
  const orgId = (process.env.ORG_ID ?? "org-admin-windtre").trim();
  const month = (process.env.CJ_MONTH ?? "2026-07").trim();

  const result = await storage.reconcileCustomerJourneys(orgId);
  console.log(
    `[customer-journey] org=${orgId} reconcile verifica: ` +
      `journeys=${result.journeys} items=${result.items} ` +
      `scartate-senza-identita=${result.skippedNoIdentity} (con pista tracciata=${result.skippedNoIdentityWithDriver})`,
  );

  const summary = await pool.query(
    `SELECT count(*)::int AS journeys_mese,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM customer_journey_items i
              WHERE i.journey_id = j.id
                AND i.data_inserimento >= (date_trunc('month', $2::date) + interval '1 month')
            ))::int AS con_acquisto_successivo
       FROM customer_journeys j
      WHERE j.organization_id = $1
        AND j.opened_at >= date_trunc('month', $2::date)
        AND j.opened_at <  date_trunc('month', $2::date) + interval '1 month'`,
    [orgId, `${month}-01`],
  );
  console.log(`[verifica] journey aperte ${month}:`, summary.rows[0]);

  const sample = await pool.query(
    `SELECT j.id, j.customer_key, j.opened_at::date AS aperta_il,
            i.driver, i.categoria, i.data_inserimento::date AS inserito_il, i.pdv_origine
       FROM customer_journeys j
       JOIN customer_journey_items i ON i.journey_id = j.id
      WHERE j.organization_id = $1
        AND j.opened_at >= date_trunc('month', $2::date)
        AND j.opened_at <  date_trunc('month', $2::date) + interval '1 month'
        AND i.data_inserimento >= (date_trunc('month', $2::date) + interval '1 month')
      ORDER BY i.data_inserimento DESC
      LIMIT 8`,
    [orgId, `${month}-01`],
  );
  for (const r of sample.rows) {
    console.log(
      `[verifica] journey ${r.id} key=${String(r.customer_key).slice(0, 4)}… aperta ${r.aperta_il} → ` +
        `${r.driver}/${r.categoria} inserito ${r.inserito_il} @ ${r.pdv_origine}`,
    );
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error("[verifica] errore:", err instanceof Error ? err.message : err);
    return pool.end().finally(() => process.exit(1));
  });
