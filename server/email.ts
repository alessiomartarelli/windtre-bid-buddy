import nodemailer, { type Transporter } from "nodemailer";

/**
 * Modulo email centralizzato. Configura un singolo transport SMTP via env:
 * - SMTP_HOST (obbligatorio per abilitare l'invio)
 * - SMTP_PORT (default 587)
 * - SMTP_SECURE ("true" per TLS implicito su porta 465; default false → STARTTLS)
 * - SMTP_USER, SMTP_PASS (opzionali, per server con auth)
 * - SMTP_FROM (es. "Incentive W3 <noreply@example.com>")
 * - APP_BASE_URL (es. "https://incentive.example.com/incentivew3") per
 *   costruire link assoluti nelle mail.
 *
 * Se SMTP_HOST non è settato, sendMail() fa un no-op loggato e ritorna
 * false: non vogliamo che lo scheduler crashi se l'admin non ha ancora
 * configurato l'SMTP.
 */

let cachedTransporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (cachedTransporter !== undefined) return cachedTransporter;
  const host = process.env.SMTP_HOST?.trim();
  if (!host) {
    cachedTransporter = null;
    return null;
  }
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const secure = (process.env.SMTP_SECURE ?? "").toLowerCase().trim() === "true"
    || port === 465;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });
  return cachedTransporter;
}

export function isEmailConfigured(): boolean {
  return !!process.env.SMTP_HOST?.trim();
}

let warnedMissingBaseUrl = false;

export function getAppBaseUrl(): string {
  const raw = process.env.APP_BASE_URL?.trim();
  if (!raw) {
    if (!warnedMissingBaseUrl) {
      console.warn(
        "[email] APP_BASE_URL non configurata: i link nelle email saranno relativi e potrebbero non essere cliccabili. " +
          "Configura APP_BASE_URL (es. https://incentive.example.com/incentivew3) per generare link assoluti.",
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
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(
      `[email] SMTP non configurato (manca SMTP_HOST), skip invio a ${
        Array.isArray(params.to) ? params.to.join(",") : params.to
      }: "${params.subject}"`,
    );
    return false;
  }
  const from = process.env.SMTP_FROM?.trim()
    || (process.env.SMTP_USER?.trim() ?? "noreply@localhost");
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
