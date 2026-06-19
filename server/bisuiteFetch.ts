import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { decryptSecret, encryptSecret, getSecretKey, isEncrypted } from "./cryptoSecret";
import { isModuleEnabled } from "../shared/modules";

/**
 * Risolve le credenziali BiSuite per una org leggendole da
 * `organization_config.config.bisuiteCredentials`. Se il `client_secret`
 * è cifrato lo decifra in memoria; se è ancora in chiaro (legacy) ed è
 * disponibile la chiave AES, lo migra opportunisticamente cifrandolo nel
 * DB con un write-through. Ritorna null se mancano credenziali utili.
 */
export async function resolveBisuiteCredentials(
  orgId: string,
): Promise<{ apiUrl: string; clientId: string; clientSecret: string } | null> {
  const orgConfig = await storage.getOrgConfig(orgId);
  const cfg = orgConfig?.config as Record<string, any> | undefined;
  const creds = cfg?.bisuiteCredentials as
    | { api_url?: string; client_id?: string; client_secret?: string }
    | undefined;
  if (!creds?.client_id || !creds?.client_secret) return null;

  let plainSecret: string;
  if (isEncrypted(creds.client_secret)) {
    const dec = decryptSecret(creds.client_secret);
    if (dec === null) {
      throw new Error(
        `Impossibile decifrare il client_secret BiSuite per org ${orgId} ` +
          `(SMTP_SECRET_KEY mancante o errata)`,
      );
    }
    plainSecret = dec;
  } else {
    plainSecret = creds.client_secret;
    // Migrazione opportunistica: cifriamo nel DB se possibile, fire-and-forget.
    if (getSecretKey()) {
      try {
        const encSecret = encryptSecret(plainSecret);
        const updatedConfig = {
          ...(cfg ?? {}),
          bisuiteCredentials: {
            api_url: creds.api_url || "",
            client_id: creds.client_id,
            client_secret: encSecret,
          },
        };
        await storage.upsertOrgConfig(
          orgId,
          updatedConfig,
          orgConfig?.configVersion || "2.0",
        );
        console.log(
          `[bisuite] client_secret migrato a cifratura AES-GCM per org ${orgId}`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[bisuite] migrazione client_secret fallita per org ${orgId}: ${msg}`);
      }
    }
  }

  return {
    apiUrl: creds.api_url || "https://db1.bisuite.app",
    clientId: creds.client_id,
    clientSecret: plainSecret,
  };
}

const BISUITE_SALES_PATH = "/api/v1/sales/full";

function deriveBaseUrl(apiUrlStr: string): string {
  try {
    const u = new URL(apiUrlStr);
    return `${u.protocol}//${u.host}`;
  } catch {
    return apiUrlStr.replace(/\/+$/, "");
  }
}

function deriveSalesEndpoint(apiUrlStr: string): string {
  return `${deriveBaseUrl(apiUrlStr)}${BISUITE_SALES_PATH}`;
}

function deriveTokenEndpoint(apiUrlStr: string): string {
  return `${deriveBaseUrl(apiUrlStr)}/api/v1/oauth/token`;
}

async function getBisuiteToken(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OAuth token request failed (${resp.status}): ${body}`);
  }
  const data = (await resp.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("No access_token in OAuth response");
  return data.access_token;
}

/**
 * Normalizza un istante (string ISO o Date) al wall-time italiano (Europe/Rome)
 * e ritorna un Date i cui componenti UTC corrispondono ai componenti italiani.
 * Quando salvato in una colonna `timestamp without time zone` di Postgres,
 * il driver formatta il Date in componenti UTC, quindi il valore persistito
 * coincide con l'ora di parete italiana.
 *
 * Casi gestiti:
 *  - stringa con `Z` o offset esplicito (es. "2026-03-31T22:00:00.000Z",
 *    "2026-04-01T00:00:00+02:00"): convertita ad Europe/Rome.
 *  - stringa naive senza fuso (es. "2026-04-01T00:00:00"): trattata come
 *    già wall-time italiano, ritornata invariata in componenti.
 *  - input null/undefined/vuoto/non parsabile: ritorna null.
 */
export function toItalianWallTime(input: string | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === "") return null;

  // Stringa naive senza fuso → già wall-time italiano: costruiamo un Date
  // i cui componenti UTC sono quelli letti dalla stringa, senza shift.
  if (typeof input === "string") {
    const naive = input.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/,
    );
    if (naive) {
      const [, y, mo, d, h, mi, s, ms] = naive;
      return new Date(Date.UTC(
        Number(y), Number(mo) - 1, Number(d),
        Number(h ?? "0"), Number(mi ?? "0"), Number(s ?? "0"),
        Number((ms ?? "0").padEnd(3, "0").slice(0, 3)),
      ));
    }
  }

  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
    d.getUTCMilliseconds(),
  ));
}

function extractSaleFields(sale: any, organizationId: string) {
  const bisuiteId = sale.id || sale.codiceEsterno || 0;
  const dataVenditaStr = sale.dataVendita || sale.createdAt;
  const dataVendita = toItalianWallTime(dataVenditaStr);

  let codicePos = "";
  let nomeNegozio = "";

  const attivitaDiretta = sale.attivita;
  if (attivitaDiretta && typeof attivitaDiretta === "object" && !Array.isArray(attivitaDiretta)) {
    codicePos = attivitaDiretta.codiceOperatoreWind || "";
    nomeNegozio = attivitaDiretta.nominativo || "";
  }
  if (!codicePos && !nomeNegozio) {
    const attivitaAddetto = sale.addetto?.attivita;
    if (Array.isArray(attivitaAddetto) && attivitaAddetto.length > 0) {
      codicePos = attivitaAddetto[0].codiceOperatoreWind || "";
      nomeNegozio = attivitaAddetto[0].nominativo || "";
    }
  }

  const ragioneSociale = sale.ragioneSociale?.azienda || "";
  const nomeAddetto = sale.addetto?.nominativo || "";
  const nomeCliente = sale.cliente?.nominativo || "";
  const totale = sale.totale || "0";
  const stato = sale.stato || "";
  const categorie = (sale.articoli || [])
    .map((a: any) => a.categoria?.nome || "")
    .filter((c: string) => c)
    .filter((c: string, i: number, arr: string[]) => arr.indexOf(c) === i)
    .join(", ");

  return {
    organizationId,
    bisuiteId: typeof bisuiteId === "number" ? bisuiteId : parseInt(bisuiteId) || 0,
    dataVendita,
    codicePos,
    nomeNegozio,
    ragioneSociale,
    nomeAddetto,
    nomeCliente,
    totale: String(totale),
    stato,
    categorieArticoli: categorie,
    rawData: sale,
  };
}

export interface BisuiteFetchResult {
  orgId: string;
  totalFromApi: number;
  inserted: number;
  updated: number;
  chunks: number;
  failedChunks: Array<{ from: string; to: string; error: string }>;
  reconciled?: { from: string; to: string; deleted: number };
}

const ITALIAN_MONTHS = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

/**
 * Trasforma un elenco di chunk falliti (mensili) in etichette uniche
 * "<mese> <anno>" in italiano, ordinate cronologicamente. Pensata per
 * essere mostrata all'utente nel toast/banner "sync parziale".
 */
export function formatFailedMonths(
  failedChunks: Array<{ from: string; to: string }>,
): string[] {
  const seen = new Set<string>();
  const out: Array<{ key: string; label: string }> = [];
  for (const c of failedChunks) {
    const m = /^(\d{4})-(\d{2})/.exec(c.from);
    if (!m) continue;
    const key = `${m[1]}-${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const monthIdx = parseInt(m[2], 10) - 1;
    const label = `${ITALIAN_MONTHS[monthIdx] ?? m[2]} ${m[1]}`;
    out.push({ key, label });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key)).map((x) => x.label);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Spezza un range [fromYMD..toYMD] in chunk mensili (allineati al 1°/ultimo
 * giorno del mese, troncati ai bordi del range). Necessario perché l'API
 * BiSuite tronca silenziosamente le risposte oltre ~13-14 giorni: chiamandola
 * con un range troppo ampio si ottengono solo gli ultimi N giorni e si
 * perdono i mesi precedenti. Con chunk mensili ciascun mese viene scaricato
 * per intero.
 */
export function buildMonthlyChunks(fromYMD: string, toYMD: string): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  const [fy, fm] = fromYMD.split("-").map(Number);
  const [ty, tm] = toYMD.split("-").map(Number);
  if (!fy || !fm || !ty || !tm) return chunks;
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    chunks.push({
      from: monthStart < fromYMD ? fromYMD : monthStart,
      to: monthEnd > toYMD ? toYMD : monthEnd,
    });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return chunks;
}

/**
 * Cap di record che l'API BiSuite restituisce per singola chiamata
 * (verificato 13/05/2026: i parametri page/offset/limit sono ignorati,
 * il cap è 5000). Quando una risposta raggiunge questo numero, la
 * dobbiamo trattare come potenzialmente troncata e bisecare il range.
 */
const BISUITE_API_HARD_CAP = 5000;

/**
 * Numero massimo di tentativi (incluso il primo) per scaricare un singolo
 * chunk mensile prima di marcarlo come fallito. Molti errori (timeout, 5xx
 * transitori, glitch di rete) sono temporanei e si recuperano con un retry
 * con backoff esponenziale, evitando all'utente di dover premere "Riprova"
 * a mano.
 */
const BISUITE_CHUNK_MAX_ATTEMPTS = 3;
const BISUITE_CHUNK_RETRY_BASE_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSalesPage(
  salesEndpoint: string,
  token: string,
  from: string,
  to: string,
): Promise<any[]> {
  const url = new URL(salesEndpoint);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`BiSuite API error (${resp.status}): ${body.slice(0, 300)}`);
  }
  const data: any = await resp.json();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.vendite)) return data.vendite;
  if (Array.isArray(data?.sales)) return data.sales;
  return [];
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return ymd2(dt);
}

function ymd2(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function daysBetween(fromYMD: string, toYMD: string): number {
  const [fy, fm, fd] = fromYMD.split("-").map(Number);
  const [ty, tm, td] = toYMD.split("-").map(Number);
  const f = Date.UTC(fy, fm - 1, fd);
  const t = Date.UTC(ty, tm - 1, td);
  return Math.round((t - f) / (24 * 3600 * 1000));
}

/**
 * Fetch con bisezione ricorsiva: se la risposta raggiunge il cap
 * `BISUITE_API_HARD_CAP` significa che il range è probabilmente troncato.
 * Spezziamo il range a metà e ricorriamo, deduplicando per id all'unione
 * (eventuali sovrapposizioni di confine sono assorbite dall'upsert
 * downstream, ma deduplichiamo qui per ridurre il payload).
 */
async function fetchSalesRange(
  salesEndpoint: string,
  token: string,
  from: string,
  to: string,
): Promise<any[]> {
  const arr = await fetchSalesPage(salesEndpoint, token, from, to);
  if (arr.length < BISUITE_API_HARD_CAP) return arr;
  const span = daysBetween(from, to);
  if (span <= 0) {
    console.warn(
      `[bisuite-fetch] cap ${BISUITE_API_HARD_CAP} raggiunto su singolo giorno ${from}: ` +
        `non posso bisecare oltre, possibile perdita dati.`,
    );
    return arr;
  }
  const midOffset = Math.floor(span / 2);
  const mid = addDays(from, midOffset);
  const next = addDays(mid, 1);
  console.warn(
    `[bisuite-fetch] cap raggiunto su ${from}→${to} (${arr.length} record), ` +
      `bisect a ${from}→${mid} | ${next}→${to}`,
  );
  const [left, right] = await Promise.all([
    fetchSalesRange(salesEndpoint, token, from, mid),
    fetchSalesRange(salesEndpoint, token, next, to),
  ]);
  // Dedup intra-fetch per id (l'upsert DB è già idempotente, ma evitiamo
  // di inflare i conteggi del log).
  const seen = new Set<string>();
  const out: any[] = [];
  for (const s of left.concat(right)) {
    const rawId = s?.id ?? s?.codiceEsterno;
    if (rawId == null) { out.push(s); continue; }
    const k = String(rawId);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/**
 * Esegue il fetch BiSuite per una singola organizzazione in modo
 * **non distruttivo**: scarica le vendite in chunk mensili e fa upsert
 * sull'unique constraint (organization_id, bisuite_id). Non cancella mai
 * record esistenti, neanche in caso di errore parziale: i chunk che
 * falliscono vengono raccolti in `failedChunks` ma non interrompono il
 * fetch degli altri mesi e lasciano intatti i dati storici.
 *
 * Se `startDate`/`endDate` non sono passati, sincronizza dall'inizio
 * dell'anno corrente fino a domani (margine di sicurezza sui fusi).
 */
export async function runBisuiteFetchForOrg(
  orgId: string,
  opts?: { startDate?: string; endDate?: string; reconcile?: boolean },
): Promise<BisuiteFetchResult> {
  const resolved = await resolveBisuiteCredentials(orgId);
  if (!resolved) {
    throw new Error(`Credenziali BiSuite assenti per org ${orgId}`);
  }

  const apiUrlStr = resolved.apiUrl;
  const tokenUrl = deriveTokenEndpoint(apiUrlStr);
  const token = await getBisuiteToken(tokenUrl, resolved.clientId, resolved.clientSecret);

  const today = new Date();
  const defaultFrom = `${today.getFullYear()}-01-01`;
  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);
  const defaultTo = ymd(tomorrow);

  const startYMD = opts?.startDate || defaultFrom;
  const endYMD = opts?.endDate || defaultTo;
  const chunks = buildMonthlyChunks(startYMD, endYMD);

  const salesEndpoint = deriveSalesEndpoint(apiUrlStr);
  // Threshold catturata PRIMA del fetch dal CLOCK del DB (non dal Node):
  // tutti gli upsert successivi useranno `now()` server-side e avranno
  // `last_seen_at >= threshold`, quindi al reconcile possiamo eliminare
  // in sicurezza i record con `last_seen_at < threshold`. Usare il DB
  // time evita drift tra clock app e DB e timezone edge effects.
  const nowResult = await db.execute(sql`select now() as now`);
  const nowRow = (nowResult as unknown as { rows: Array<{ now: Date | string }> }).rows?.[0];
  const reconcileThreshold = nowRow ? new Date(nowRow.now as any) : new Date();
  let totalFromApi = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  const failedChunks: Array<{ from: string; to: string; error: string }> = [];

  for (const c of chunks) {
    let attempt = 0;
    let lastErr: unknown = null;
    let success = false;
    while (attempt < BISUITE_CHUNK_MAX_ATTEMPTS && !success) {
      attempt++;
      try {
        const sales = await fetchSalesRange(salesEndpoint, token, c.from, c.to);
        const records = sales.map((s) => extractSaleFields(s, orgId));
        const stats = await storage.upsertBisuiteSales(records);
        totalFromApi += sales.length;
        totalInserted += stats.inserted;
        totalUpdated += stats.updated;
        const retryNote = attempt > 1 ? ` (riuscito al tentativo ${attempt}/${BISUITE_CHUNK_MAX_ATTEMPTS})` : "";
        console.log(
          `[bisuite-chunk] org=${orgId} ${c.from}→${c.to}: api=${sales.length} ` +
            `inseriti=${stats.inserted} aggiornati=${stats.updated}${retryNote}`,
        );
        success = true;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < BISUITE_CHUNK_MAX_ATTEMPTS) {
          const delayMs = BISUITE_CHUNK_RETRY_BASE_MS * Math.pow(2, attempt - 1);
          console.warn(
            `[bisuite-chunk] retry org=${orgId} ${c.from}→${c.to} ` +
              `tentativo ${attempt}/${BISUITE_CHUNK_MAX_ATTEMPTS} fallito: ${msg}. ` +
              `Ritento tra ${delayMs}ms`,
          );
          await sleep(delayMs);
        }
      }
    }
    if (!success) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      failedChunks.push({ from: c.from, to: c.to, error: msg });
      console.error(
        `[bisuite-chunk] FAIL org=${orgId} ${c.from}→${c.to} dopo ` +
          `${BISUITE_CHUNK_MAX_ATTEMPTS} tentativi: ${msg}`,
      );
    }
  }

  let reconciled: { from: string; to: string; deleted: number } | undefined;
  // Reconcile solo se richiesto esplicitamente E non ci sono chunk falliti:
  // un chunk fallito significa che potrebbero esistere record nel range che
  // non abbiamo potuto rivedere — eliminarli equivarrebbe a perdere dati
  // ancora vivi su BiSuite.
  if (opts?.reconcile && failedChunks.length === 0 && chunks.length > 0) {
    try {
      const r = await storage.reconcileBisuiteSales(orgId, startYMD, endYMD, reconcileThreshold);
      reconciled = { from: startYMD, to: endYMD, deleted: r.deleted };
      console.log(
        `[bisuite-reconcile] org=${orgId} ${startYMD}→${endYMD}: ` +
          `eliminati=${r.deleted} (last_seen_at < ${reconcileThreshold.toISOString()})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[bisuite-reconcile] FAIL org=${orgId} ${startYMD}→${endYMD}: ${msg}`);
      throw err;
    }
  } else if (opts?.reconcile && failedChunks.length > 0) {
    console.warn(
      `[bisuite-reconcile] SKIP org=${orgId}: ${failedChunks.length} chunk falliti, ` +
        `reconcile non sicuro (potrebbe eliminare record ancora vivi).`,
    );
  }

  // Apertura automatica delle Customer Journey (Task #158): se l'org ha il
  // modulo `customer_journey` abilitato e il fetch ha visto dei dati, rigenera
  // le journey dalle vendite appena importate, così le nuove attivazioni mobile
  // (dalla trigger date) aprono una journey senza intervento manuale.
  // Best-effort: un errore qui non deve invalidare il fetch.
  try {
    const org = await storage.getOrganization(orgId);
    if (org && isModuleEnabled(org.enabledModules ?? null, "customer_journey") && chunks.length > 0) {
      const cj = await storage.reconcileCustomerJourneys(orgId);
      console.log(
        `[customer-journey] org=${orgId} reconcile post-fetch: ` +
          `journeys=${cj.journeys} items=${cj.items}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[customer-journey] FAIL reconcile post-fetch org=${orgId}: ${msg}`);
  }

  return {
    orgId,
    totalFromApi,
    inserted: totalInserted,
    updated: totalUpdated,
    chunks: chunks.length,
    failedChunks,
    reconciled,
  };
}

/**
 * Esegue il fetch per tutte le organizzazioni che hanno credenziali BiSuite.
 * Le org senza credenziali vengono saltate silenziosamente; gli errori per
 * singola org vengono loggati ma non bloccano le altre.
 */
export async function runBisuiteFetchForAllOrgs(): Promise<{
  ok: BisuiteFetchResult[];
  partial: Array<BisuiteFetchResult & { orgName: string; failedMonths: string[] }>;
  failed: Array<{ orgId: string; orgName: string; error: string }>;
}> {
  const orgs = await storage.getOrganizations();
  const ok: BisuiteFetchResult[] = [];
  const partial: Array<BisuiteFetchResult & { orgName: string; failedMonths: string[] }> = [];
  const failed: Array<{ orgId: string; orgName: string; error: string }> = [];

  for (const org of orgs) {
    const cfg = await storage.getOrgConfig(org.id);
    const creds = (cfg?.config as any)?.bisuiteCredentials;
    if (!creds?.client_id || !creds?.client_secret) continue;
    try {
      const r = await runBisuiteFetchForOrg(org.id);
      if (r.failedChunks.length > 0) {
        const failedMonths = formatFailedMonths(r.failedChunks);
        partial.push({ ...r, orgName: org.name, failedMonths });
        console.warn(
          `[bisuite-scheduler] org=${org.id} (${org.name}) PARTIAL: ` +
            `api=${r.totalFromApi} inseriti=${r.inserted} aggiornati=${r.updated} ` +
            `chunk=${r.chunks} falliti=${r.failedChunks.length} ` +
            `mesi_mancanti=[${failedMonths.join(", ")}]`,
        );
      } else {
        ok.push(r);
        console.log(
          `[bisuite-scheduler] org=${org.id} (${org.name}) OK: ` +
            `api=${r.totalFromApi} inseriti=${r.inserted} aggiornati=${r.updated} ` +
            `chunk=${r.chunks}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ orgId: org.id, orgName: org.name, error: msg });
      console.error(`[bisuite-scheduler] org=${org.id} (${org.name}) FAIL: ${msg}`);
    }
  }
  return { ok, partial, failed };
}
