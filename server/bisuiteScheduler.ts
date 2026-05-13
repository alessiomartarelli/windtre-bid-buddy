import { runBisuiteFetchForAllOrgs, runBisuiteFetchForOrg, formatFailedMonths } from "./bisuiteFetch";
import { storage } from "./storage";

const ROME_TZ = "Europe/Rome";

/**
 * Calcola i ms da ora alla prossima mezzanotte locale Europe/Rome.
 * Funziona indipendentemente dal fuso del server (CET, CEST, UTC, ecc.).
 */
function msUntilNextRomeMidnight(now: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ROME_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const h = parseInt(get("hour"), 10);
  const m = parseInt(get("minute"), 10);
  const s = parseInt(get("second"), 10);
  const elapsedMs = ((h * 3600) + (m * 60) + s) * 1000;
  const dayMs = 24 * 3600 * 1000;
  // +5 secondi di sicurezza per evitare di trovarci ancora a 23:59:59.x
  return dayMs - elapsedMs + 5_000;
}

function formatRomeNow(): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: ROME_TZ,
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date());
}

/**
 * Restituisce {year, month} (month 1-12) della data corrente in fuso Europe/Rome.
 */
function romeYearMonth(now: Date = new Date()): { year: number; month: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ROME_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
  };
}

/**
 * Range YMD [primo del mese .. ultimo giorno del mese] per (year, month 1-12).
 * Usa la data dell'ultimo giorno del mese come endDate (inclusivo lato BiSuite).
 */
function monthRange(year: number, month: number): { from: string; to: string } {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

function isAutoReconcileEnabled(): boolean {
  const v = (process.env.BISUITE_AUTO_RECONCILE ?? "true").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

function isPrevMonthReconcileEnabled(): boolean {
  const v = (process.env.BISUITE_AUTO_RECONCILE_PREV_MONTH ?? "false").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/**
 * Numero di giorni di retention per le notifiche già lette.
 * Default: 30 giorni. Configurabile via env BISUITE_NOTIFICATIONS_RETENTION_DAYS.
 * Le notifiche non lette non vengono mai cancellate.
 */
function getNotificationRetentionDays(): number {
  const raw = process.env.BISUITE_NOTIFICATIONS_RETENTION_DAYS;
  if (!raw) return 30;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 30;
  return n;
}

async function cleanupOldReadNotifications(): Promise<void> {
  const days = getNotificationRetentionDays();
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
  try {
    const { deleted } = await storage.deleteOldReadBisuiteSyncNotifications(cutoff);
    console.log(
      `[bisuite-scheduler] cleanup notifiche lette più vecchie di ${days}gg ` +
        `(< ${cutoff.toISOString()}): eliminate=${deleted}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bisuite-scheduler] cleanup notifiche fallito: ${msg}`);
  }
}

/**
 * Esegue un reconcile sul range mensile dato per tutte le org con credenziali
 * BiSuite. Logga per ogni org quanti record sono stati eliminati e quali
 * chunk sono stati skippati (chunk falliti = reconcile non eseguito).
 */
async function runMonthlyReconcileForAllOrgs(
  label: string,
  range: { from: string; to: string },
): Promise<void> {
  const orgs = await storage.getOrganizations();
  for (const org of orgs) {
    const orgConfig = await storage.getOrgConfig(org.id);
    const cfg = orgConfig?.config as Record<string, unknown> | undefined;
    const creds = cfg?.bisuiteCredentials as
      | { client_id?: string; client_secret?: string }
      | undefined;
    if (!creds?.client_id || !creds?.client_secret) continue;
    try {
      const r = await runBisuiteFetchForOrg(org.id, {
        startDate: range.from,
        endDate: range.to,
        reconcile: true,
      });
      if (r.reconciled) {
        console.log(
          `[bisuite-scheduler] reconcile ${label} org=${org.id} (${org.name}) ` +
            `${r.reconciled.from}→${r.reconciled.to}: ` +
            `eliminati=${r.reconciled.deleted} ` +
            `(api=${r.totalFromApi} inseriti=${r.inserted} aggiornati=${r.updated})`,
        );
      } else if (r.failedChunks.length > 0) {
        const failedMonths = formatFailedMonths(r.failedChunks);
        console.warn(
          `[bisuite-scheduler] reconcile ${label} SKIP org=${org.id} (${org.name}): ` +
            `${r.failedChunks.length} chunk falliti, mesi=[${failedMonths.join(", ")}], ` +
            `reconcile non eseguito per evitare cancellazioni indebite.`,
        );
      } else {
        console.log(
          `[bisuite-scheduler] reconcile ${label} org=${org.id} (${org.name}): ` +
            `nessun record da eliminare (api=${r.totalFromApi}).`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[bisuite-scheduler] reconcile ${label} FAIL org=${org.id} (${org.name}): ${msg}`,
      );
    }
  }
}

let started = false;

/**
 * Avvia lo scheduler che esegue runBisuiteFetchForAllOrgs() ogni giorno
 * alle 00:00 ora italiana. Idempotente: chiamandolo più volte parte una
 * sola volta. Il fetch manuale via POST /api/bisuite-fetch resta invariato.
 *
 * Dopo il fetch, se BISUITE_AUTO_RECONCILE è abilitato (default: true),
 * esegue un reconcile sul mese corrente per ogni org con credenziali, in
 * modo da rimuovere dalla copia locale le vendite cancellate su BiSuite.
 * Se BISUITE_AUTO_RECONCILE_PREV_MONTH è abilitato (default: false), il
 * reconcile viene eseguito anche sul mese precedente.
 */
export function startBisuiteDailyScheduler(): void {
  if (started) return;
  started = true;

  const scheduleNext = () => {
    const delay = msUntilNextRomeMidnight();
    const nextRun = new Date(Date.now() + delay);
    console.log(
      `[bisuite-scheduler] prossimo fetch automatico programmato per ` +
        `${nextRun.toISOString()} (tra ~${Math.round(delay / 60000)} min, ora attuale Roma: ${formatRomeNow()})`,
    );
    setTimeout(async () => {
      const startedAt = Date.now();
      console.log(`[bisuite-scheduler] avvio fetch automatico (Roma: ${formatRomeNow()})`);
      try {
        const result = await runBisuiteFetchForAllOrgs();
        const ms = Date.now() - startedAt;
        console.log(
          `[bisuite-scheduler] completato in ${ms} ms — ok: ${result.ok.length}, ` +
            `partial: ${result.partial.length}, failed: ${result.failed.length}`,
        );
        if (result.partial.length > 0) {
          for (const p of result.partial) {
            console.warn(
              `[bisuite-scheduler] PARTIAL org=${p.orgId} (${p.orgName}): ` +
                `mesi mancanti = [${p.failedMonths.join(", ")}]. ` +
                `Riprovare con sync manuale.`,
            );
            try {
              await storage.createBisuiteSyncNotification({
                organizationId: p.orgId,
                status: "partial",
                failedMonths: p.failedMonths,
                errorMessage: null,
              });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.error(`[bisuite-scheduler] impossibile creare notifica partial per org=${p.orgId}: ${msg}`);
            }
          }
        }
        if (result.failed.length > 0) {
          for (const f of result.failed) {
            console.error(
              `[bisuite-scheduler] FAILED org=${f.orgId} (${f.orgName}): ${f.error}`,
            );
            try {
              await storage.createBisuiteSyncNotification({
                organizationId: f.orgId,
                status: "failed",
                failedMonths: [],
                errorMessage: f.error,
              });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.error(`[bisuite-scheduler] impossibile creare notifica failed per org=${f.orgId}: ${msg}`);
            }
          }
        }

        if (isAutoReconcileEnabled()) {
          const { year, month } = romeYearMonth();
          const current = monthRange(year, month);
          console.log(
            `[bisuite-scheduler] avvio reconcile mese corrente ${current.from}→${current.to}`,
          );
          await runMonthlyReconcileForAllOrgs("mese-corrente", current);

          if (isPrevMonthReconcileEnabled()) {
            const prevMonth = month === 1 ? 12 : month - 1;
            const prevYear = month === 1 ? year - 1 : year;
            const prev = monthRange(prevYear, prevMonth);
            console.log(
              `[bisuite-scheduler] avvio reconcile mese precedente ${prev.from}→${prev.to}`,
            );
            await runMonthlyReconcileForAllOrgs("mese-precedente", prev);
          }
        } else {
          console.log(
            `[bisuite-scheduler] auto-reconcile disabilitato ` +
              `(BISUITE_AUTO_RECONCILE=${process.env.BISUITE_AUTO_RECONCILE ?? "true"}).`,
          );
        }

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[bisuite-scheduler] errore fatale durante il fetch: ${msg}`);
      } finally {
        // Cleanup notifiche vecchie eseguito sempre, anche se fetch/reconcile
        // hanno lanciato eccezioni: la retention è indipendente dalla sync.
        await cleanupOldReadNotifications();
        scheduleNext();
      }
    }, delay).unref?.();
  };

  scheduleNext();
}
