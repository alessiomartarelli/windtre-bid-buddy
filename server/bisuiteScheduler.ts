import { runBisuiteFetchForAllOrgs } from "./bisuiteFetch";

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

let started = false;

/**
 * Avvia lo scheduler che esegue runBisuiteFetchForAllOrgs() ogni giorno
 * alle 00:00 ora italiana. Idempotente: chiamandolo più volte parte una
 * sola volta. Il fetch manuale via POST /api/bisuite-fetch resta invariato.
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
            `failed: ${result.failed.length}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[bisuite-scheduler] errore fatale durante il fetch: ${msg}`);
      } finally {
        scheduleNext();
      }
    }, delay).unref?.();
  };

  scheduleNext();
}
