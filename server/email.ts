import nodemailer, { type Transporter } from "nodemailer";
import { storage } from "./storage";
import { decryptSecret, encryptSecret, getSecretKey, isEncrypted } from "./cryptoSecret";

/**
 * Modulo email centralizzato. La configurazione SMTP viene letta da:
 *   1. `system_config` (chiave `smtp_config`), gestibile dal super admin via UI
 *   2. variabili d'ambiente come fallback (SMTP_HOST/PORT/SECURE/USER/PASS/FROM, APP_BASE_URL)
 *
 * Se nessuna delle due fonti fornisce un host SMTP, sendMail() fa un no-op
 * loggato e ritorna false: non vogliamo che lo scheduler crashi se l'admin
 * non ha ancora configurato l'SMTP.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  baseUrl: string;
}

export const SMTP_CONFIG_KEY = "smtp_config";

let cachedConfig: SmtpConfig | null = null;
let cachedTransporter: Transporter | null = null;

function readEnvConfig(): SmtpConfig {
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  return {
    host: process.env.SMTP_HOST?.trim() ?? "",
    port: Number.isFinite(port) ? port : 587,
    secure:
      (process.env.SMTP_SECURE ?? "").toLowerCase().trim() === "true" ||
      port === 465,
    user: process.env.SMTP_USER?.trim() ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM?.trim() ?? "",
    baseUrl: (process.env.APP_BASE_URL?.trim() ?? "").replace(/\/+$/, ""),
  };
}

function mergeConfig(env: SmtpConfig, db: Partial<SmtpConfig> | null | undefined): SmtpConfig {
  const merged: SmtpConfig = { ...env };
  if (!db) return merged;
  if (typeof db.host === "string" && db.host.trim()) merged.host = db.host.trim();
  if (typeof db.port === "number" && Number.isFinite(db.port)) merged.port = db.port;
  if (typeof db.secure === "boolean") merged.secure = db.secure;
  if (typeof db.user === "string") merged.user = db.user.trim();
  if (typeof db.pass === "string" && db.pass.length > 0) merged.pass = db.pass;
  if (typeof db.from === "string" && db.from.trim()) merged.from = db.from.trim();
  if (typeof db.baseUrl === "string" && db.baseUrl.trim()) {
    merged.baseUrl = db.baseUrl.trim().replace(/\/+$/, "");
  }
  return merged;
}

/**
 * Migra la password salvata in chiaro nel DB cifrandola con AES-GCM. Idempotente:
 * se la password è già cifrata o se manca la chiave di cifratura non fa nulla.
 */
async function migratePlainPassword(
  raw: Partial<SmtpConfig>,
  updatedBy: string | null,
): Promise<void> {
  if (typeof raw.pass !== "string" || raw.pass.length === 0) return;
  if (isEncrypted(raw.pass)) return;
  if (!getSecretKey()) return;
  try {
    const next = { ...raw, pass: encryptSecret(raw.pass) };
    await storage.upsertSystemConfig(SMTP_CONFIG_KEY, next, updatedBy);
    console.log(`[email] password SMTP migrata a cifratura AES-GCM in ${SMTP_CONFIG_KEY}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[email] migrazione password SMTP fallita: ${msg}`);
  }
}

export async function loadEmailConfig(force = false): Promise<SmtpConfig> {
  if (!force && cachedConfig) return cachedConfig;
  const env = readEnvConfig();
  let dbConfig: Partial<SmtpConfig> | null = null;
  try {
    const sys = await storage.getSystemConfig(SMTP_CONFIG_KEY);
    if (sys?.config && typeof sys.config === "object") {
      const raw = sys.config as Partial<SmtpConfig>;
      // Migrazione one-shot: se la password è ancora in chiaro la cifriamo
      // ora che la chiave è disponibile. Non blocca la load (fire-and-forget
      // ma awaited per coerenza del cache successivo).
      if (
        typeof raw.pass === "string" &&
        raw.pass.length > 0 &&
        !isEncrypted(raw.pass) &&
        getSecretKey()
      ) {
        // updatedBy è nullable nello schema: se manca passiamo null, lo
        // accettiamo come "sistema" (la colonna è nullable).
        await migratePlainPassword(raw, sys.updatedBy ?? null);
      }
      // Risoluzione della password con politica strict:
      //   - se è cifrata: tentiamo decifratura; se fallisce o la chiave
      //     manca, IGNORIAMO la pass DB → fallback env-only.
      //   - se è in chiaro (legacy non ancora migrato) e abbiamo la chiave,
      //     la migrazione sopra l'avrà appena cifrata; la usiamo solo se
      //     la chiave c'è. Senza chiave, NON usiamo mai una pass DB in
      //     chiaro: forziamo l'env-only fallback richiesto dalla policy.
      let resolvedPass: string | undefined;
      if (typeof raw.pass === "string" && raw.pass.length > 0) {
        if (isEncrypted(raw.pass)) {
          const dec = decryptSecret(raw.pass);
          if (dec === null) {
            console.warn(
              `[email] impossibile decifrare la password SMTP da ${SMTP_CONFIG_KEY} (chiave SMTP_SECRET_KEY mancante o errata): fallback a env-only per la password`,
            );
          } else {
            resolvedPass = dec;
          }
        } else if (getSecretKey()) {
          // Plaintext legacy con chiave disponibile: dopo la migrazione
          // possiamo usarla in memoria per questa request.
          resolvedPass = raw.pass;
        } else {
          console.warn(
            `[email] password SMTP in DB ancora in chiaro ma SMTP_SECRET_KEY mancante: fallback a env-only (la migrazione cifrerà al primo restart con la chiave configurata)`,
          );
        }
      }
      dbConfig = { ...raw, pass: resolvedPass };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[email] impossibile leggere ${SMTP_CONFIG_KEY} dal DB, uso solo env: ${msg}`);
  }
  cachedConfig = mergeConfig(env, dbConfig);
  cachedTransporter = null;
  return cachedConfig;
}

export function invalidateEmailConfigCache(): void {
  cachedConfig = null;
  cachedTransporter = null;
}

async function getTransporter(): Promise<Transporter | null> {
  const config = await loadEmailConfig();
  if (!config.host) return null;
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
  });
  return cachedTransporter;
}

export async function isEmailConfigured(): Promise<boolean> {
  const cfg = await loadEmailConfig();
  return !!cfg.host;
}

let warnedMissingBaseUrl = false;

export function getAppBaseUrl(): string {
  const cached = cachedConfig?.baseUrl;
  if (cached) return cached;
  const raw = process.env.APP_BASE_URL?.trim();
  if (!raw) {
    if (!warnedMissingBaseUrl) {
      console.warn(
        "[email] APP_BASE_URL non configurata: i link nelle email saranno relativi e potrebbero non essere cliccabili. " +
          "Configura APP_BASE_URL (o il campo Base URL dal pannello SMTP) per generare link assoluti.",
      );
      warnedMissingBaseUrl = true;
    }
    return "";
  }
  return raw.replace(/\/+$/, "");
}

export interface SendMailParams {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}

export async function sendMail(params: SendMailParams): Promise<boolean> {
  const transporter = await getTransporter();
  if (!transporter) {
    console.warn(
      `[email] SMTP non configurato (manca host SMTP), skip invio a ${
        Array.isArray(params.to) ? params.to.join(",") : params.to
      }: "${params.subject}"`,
    );
    return false;
  }
  const config = await loadEmailConfig();
  const from = config.from || config.user || "noreply@localhost";
  // Multi-destinatario: usiamo BCC per non esporre gli indirizzi degli
  // altri admin della stessa org. Se c'è un solo destinatario va in `to`.
  const recipients = Array.isArray(params.to) ? params.to : [params.to];
  const useBcc = recipients.length > 1;
  try {
    const info = await transporter.sendMail({
      from,
      to: useBcc ? from : recipients[0],
      bcc: useBcc ? recipients : undefined,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
    console.log(
      `[email] inviata "${params.subject}" → ${
        Array.isArray(params.to) ? params.to.join(",") : params.to
      } (messageId=${info.messageId})`,
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[email] errore invio "${params.subject}" → ${
        Array.isArray(params.to) ? params.to.join(",") : params.to
      }: ${msg}`,
    );
    return false;
  }
}

/**
 * Invia un'email di test usando una configurazione SMTP specifica (non quella
 * cachata). Utile per il pulsante "Invia email di test" del super admin: vogliamo
 * testare la config appena salvata e ottenere un errore dettagliato in caso di
 * fallimento, senza inquinare il transporter cachato del runtime.
 */
export async function sendTestEmailWithConfig(
  config: SmtpConfig,
  recipient: string,
  triggeredBy?: string,
): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> {
  if (!config.host) {
    return { ok: false, error: "Host SMTP mancante" };
  }
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
  });
  const from = config.from || config.user || "noreply@localhost";
  const { subject, html, text } = buildTestEmail({ recipient, triggeredBy });
  try {
    const info = await transporter.sendMail({ from, to: recipient, subject, html, text });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Verifica la connessione SMTP usando una configurazione specifica senza
 * inviare alcuna email. Sfrutta `transporter.verify()` di nodemailer per
 * validare host/porta/credenziali. Utile per il pulsante "Verifica
 * connessione" del super admin.
 */
export async function verifySmtpConnectionWithConfig(
  config: SmtpConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!config.host) {
    return { ok: false, error: "Host SMTP mancante" };
  }
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
  });
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface BisuiteSyncFailureEmailParams {
  orgName: string;
  status: "partial" | "failed";
  failedMonths: string[];
  errorMessage: string | null;
}

export function buildBisuiteSyncFailureEmail(p: BisuiteSyncFailureEmailParams): {
  subject: string;
  html: string;
  text: string;
} {
  const base = getAppBaseUrl();
  const link = base ? `${base}/vendite-bisuite` : "/vendite-bisuite";
  const statusLabel = p.status === "partial" ? "PARZIALE" : "FALLITA";
  const subject = `[Incentive W3] Sync BiSuite ${statusLabel} – ${p.orgName}`;

  const detailsHtml = p.status === "partial"
    ? `<p>La sincronizzazione notturna è stata completata solo parzialmente. Mesi non scaricati:</p>
       <ul>${p.failedMonths.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>
       <p>Esegui una sync manuale dalla pagina Vendite BiSuite per recuperare i dati mancanti.</p>`
    : `<p>La sincronizzazione notturna è fallita con il seguente errore:</p>
       <pre style="background:#f4f4f5;padding:12px;border-radius:6px;white-space:pre-wrap;">${escapeHtml(p.errorMessage ?? "Errore sconosciuto")}</pre>
       <p>Verifica le credenziali BiSuite dell'organizzazione e riprova.</p>`;

  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;">
    <h2>Sync BiSuite ${statusLabel}</h2>
    <p><strong>Organizzazione:</strong> ${escapeHtml(p.orgName)}</p>
    ${detailsHtml}
    <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">Apri Vendite BiSuite</a></p>
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
    <p style="font-size:12px;color:#71717a;">Ricevi questa email perché sei amministratore dell'organizzazione. Puoi disattivare le notifiche email dal tuo profilo.</p>
  </body></html>`;

  const textParts: string[] = [
    `Sync BiSuite ${statusLabel}`,
    `Organizzazione: ${p.orgName}`,
    "",
  ];
  if (p.status === "partial") {
    textParts.push(`Mesi non scaricati: ${p.failedMonths.join(", ") || "(nessuno)"}`);
    textParts.push("Esegui una sync manuale dalla pagina Vendite BiSuite per recuperare i dati.");
  } else {
    textParts.push(`Errore: ${p.errorMessage ?? "Errore sconosciuto"}`);
    textParts.push("Verifica le credenziali BiSuite e riprova.");
  }
  textParts.push("", `Apri Vendite BiSuite: ${link}`);
  textParts.push("");
  textParts.push("Puoi disattivare le notifiche email dal tuo profilo.");

  return { subject, html, text: textParts.join("\n") };
}

export interface TestEmailParams {
  recipient: string;
  triggeredBy?: string;
}

export function buildTestEmail(p: TestEmailParams): { subject: string; html: string; text: string } {
  const base = getAppBaseUrl();
  const subject = "[Incentive W3] Email di test SMTP";
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;">
    <h2>Email di test ricevuta correttamente</h2>
    <p>Se vedi questo messaggio, la configurazione SMTP di Incentive W3 funziona.</p>
    ${p.triggeredBy ? `<p style="color:#71717a;font-size:12px;">Inviata da: ${escapeHtml(p.triggeredBy)}</p>` : ""}
    ${base ? `<p style="color:#71717a;font-size:12px;">Base URL applicazione: ${escapeHtml(base)}</p>` : ""}
  </body></html>`;
  const text = [
    "Email di test SMTP — Incentive W3",
    "",
    "Se vedi questo messaggio, la configurazione SMTP funziona correttamente.",
    p.triggeredBy ? `Inviata da: ${p.triggeredBy}` : "",
    base ? `Base URL applicazione: ${base}` : "",
  ].filter(Boolean).join("\n");
  return { subject, html, text };
}
