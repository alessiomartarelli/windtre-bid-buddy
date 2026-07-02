/**
 * Invio messaggi via Telegram Bot API (Task #239). Nessuna dipendenza
 * esterna: usa fetch nativo verso api.telegram.org. Il token del bot è
 * per-organizzazione, salvato cifrato in organization_config
 * (config.telegramReport.bot_token) e decifrato dal chiamante.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

// Limite hard di Telegram per il testo di un messaggio.
const TELEGRAM_MAX_LENGTH = 4096;

export interface TelegramSendResult {
  ok: boolean;
  error?: string;
}

/**
 * Invia un messaggio di testo (parse_mode HTML) alla chat indicata.
 * Non lancia mai: ritorna { ok, error } così lo scheduler può loggare
 * il fallimento senza bloccare le altre organizzazioni.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<TelegramSendResult> {
  if (!botToken || !chatId) {
    return { ok: false, error: "Bot token o chat ID mancante" };
  }
  // Telegram rifiuta messaggi oltre 4096 caratteri: tronchiamo con avviso.
  let body = text;
  if (body.length > TELEGRAM_MAX_LENGTH) {
    const suffix = "\n… (troncato)";
    body = body.slice(0, TELEGRAM_MAX_LENGTH - suffix.length) + suffix;
  }
  try {
    const resp = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: body,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const data = (await resp.json().catch(() => null)) as
      | { ok?: boolean; description?: string }
      | null;
    if (!resp.ok || !data?.ok) {
      const desc = data?.description || `HTTP ${resp.status}`;
      return { ok: false, error: desc };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Invia un documento (file allegato) alla chat indicata via sendDocument
 * (multipart/form-data con FormData/Blob nativi di Node 18+). Usato per il
 * report HTML giornaliero (Task #248). Non lancia mai: ritorna { ok, error }
 * — un fallimento dell'allegato NON deve bloccare il messaggio di testo.
 */
export async function sendTelegramDocument(
  botToken: string,
  chatId: string,
  fileName: string,
  content: string,
  options?: { caption?: string; mimeType?: string },
): Promise<TelegramSendResult> {
  if (!botToken || !chatId) {
    return { ok: false, error: "Bot token o chat ID mancante" };
  }
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (options?.caption) form.append("caption", options.caption.slice(0, 1024));
    form.append(
      "document",
      new Blob([content], { type: options?.mimeType ?? "text/html" }),
      fileName,
    );
    const resp = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendDocument`, {
      method: "POST",
      body: form,
    });
    const data = (await resp.json().catch(() => null)) as
      | { ok?: boolean; description?: string }
      | null;
    if (!resp.ok || !data?.ok) {
      const desc = data?.description || `HTTP ${resp.status}`;
      return { ok: false, error: desc };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
