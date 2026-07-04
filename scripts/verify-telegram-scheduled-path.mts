/**
 * Verifica una tantum del percorso SCHEDULATO del report Telegram
 * (Task #242): replica esattamente runScheduledSend — di default per
 * TUTTE le org con bot attivo (come farebbe lo scheduler) —
 * resolveTelegramConfig (decrypt token) + sendDailyReportForOrg con
 * syncFirst: true (sync BiSuite del giorno → aggregazione dal DB →
 * invio reale nel gruppo).
 *
 * Con ORG_ID=<id> limita l'invio a quella sola organizzazione.
 *
 * Da lanciare con DATABASE_URL puntato al DB di PROD (tunnel SSH) e
 * SMTP_SECRET_KEY di PROD. Non stampa mai token o segreti.
 */
import { storage } from "../server/storage";
import { pool } from "../server/db";
import {
  resolveTelegramConfig,
  sendDailyReportForOrg,
} from "../server/telegramReportScheduler";

async function main() {
  const onlyOrgId = (process.env.ORG_ID ?? "").trim();
  let orgs = await storage.getOrganizations();
  if (onlyOrgId) {
    orgs = orgs.filter((o) => o.id === onlyOrgId);
    if (orgs.length === 0) {
      console.error(`[verifica] nessuna organizzazione con id=${onlyOrgId}`);
      await pool.end();
      process.exit(1);
    }
  }
  console.log(
    `[verifica] organizzazioni considerate: ${orgs.length}${onlyOrgId ? ` (filtro ORG_ID=${onlyOrgId})` : ""}`,
  );
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const org of orgs) {
    const orgConfig = await storage.getOrgConfig(org.id);
    const cfg = orgConfig?.config as Record<string, unknown> | undefined;
    const tg = resolveTelegramConfig(cfg?.telegramReport);
    if (!tg) {
      skipped++;
      continue;
    }
    console.log(
      `[verifica] org=${org.id} (${org.name}): config OK, token decifrato, chat_id presente. Invio...`,
    );
    const r = await sendDailyReportForOrg({
      orgId: org.id,
      orgName: org.name,
      botToken: tg.botToken,
      chatId: tg.chatId,
      timeLabel: (process.env.TIME_LABEL ?? "verifica scheduler (prova pre-13:30)").trim(),
      // SYNC_FIRST=0 salta la sync BiSuite (utile al 2° invio ravvicinato).
      syncFirst: process.env.SYNC_FIRST !== "0",
    });
    if (r.ok) {
      sent++;
      console.log(`[verifica] INVIATO org=${org.id} (${org.name})`);
    } else {
      failed++;
      console.error(`[verifica] FALLITO org=${org.id} (${org.name}): ${r.error}`);
    }
  }
  console.log(
    `[verifica] completata — inviati: ${sent}, falliti: ${failed}, org senza bot: ${skipped}`,
  );
  await pool.end();
  if (failed > 0 || sent === 0) process.exit(1);
}

main().catch((err) => {
  console.error(`[verifica] errore fatale: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
