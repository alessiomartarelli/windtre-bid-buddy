import { storage } from "./storage";

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

async function fetchSalesRange(
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
  opts?: { startDate?: string; endDate?: string },
): Promise<BisuiteFetchResult> {
  const orgConfig = await storage.getOrgConfig(orgId);
  const cfg = orgConfig?.config as Record<string, any> | undefined;
  const creds = cfg?.bisuiteCredentials;
  if (!creds?.client_id || !creds?.client_secret) {
    throw new Error(`Credenziali BiSuite assenti per org ${orgId}`);
  }

  const apiUrlStr = creds.api_url || "https://db1.bisuite.app";
  const tokenUrl = deriveTokenEndpoint(apiUrlStr);
  const token = await getBisuiteToken(tokenUrl, creds.client_id, creds.client_secret);

  const today = new Date();
  const defaultFrom = `${today.getFullYear()}-01-01`;
  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);
  const defaultTo = ymd(tomorrow);

  const startYMD = opts?.startDate || defaultFrom;
  const endYMD = opts?.endDate || defaultTo;
  const chunks = buildMonthlyChunks(startYMD, endYMD);

  const salesEndpoint = deriveSalesEndpoint(apiUrlStr);
  let totalFromApi = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  const failedChunks: Array<{ from: string; to: string; error: string }> = [];

  for (const c of chunks) {
    try {
      const sales = await fetchSalesRange(salesEndpoint, token, c.from, c.to);
      const records = sales.map((s) => extractSaleFields(s, orgId));
      const stats = await storage.upsertBisuiteSales(records);
      totalFromApi += sales.length;
      totalInserted += stats.inserted;
      totalUpdated += stats.updated;
      console.log(
        `[bisuite-chunk] org=${orgId} ${c.from}→${c.to}: api=${sales.length} ` +
          `inseriti=${stats.inserted} aggiornati=${stats.updated}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failedChunks.push({ from: c.from, to: c.to, error: msg });
      console.error(`[bisuite-chunk] FAIL org=${orgId} ${c.from}→${c.to}: ${msg}`);
    }
  }

  return {
    orgId,
    totalFromApi,
    inserted: totalInserted,
    updated: totalUpdated,
    chunks: chunks.length,
    failedChunks,
  };
}

/**
 * Esegue il fetch per tutte le organizzazioni che hanno credenziali BiSuite.
 * Le org senza credenziali vengono saltate silenziosamente; gli errori per
 * singola org vengono loggati ma non bloccano le altre.
 */
export async function runBisuiteFetchForAllOrgs(): Promise<{
  ok: BisuiteFetchResult[];
  failed: Array<{ orgId: string; error: string }>;
}> {
  const orgs = await storage.getOrganizations();
  const ok: BisuiteFetchResult[] = [];
  const failed: Array<{ orgId: string; error: string }> = [];

  for (const org of orgs) {
    const cfg = await storage.getOrgConfig(org.id);
    const creds = (cfg?.config as any)?.bisuiteCredentials;
    if (!creds?.client_id || !creds?.client_secret) continue;
    try {
      const r = await runBisuiteFetchForOrg(org.id);
      ok.push(r);
      console.log(
        `[bisuite-scheduler] org=${org.id} (${org.name}) OK: ` +
          `api=${r.totalFromApi} inseriti=${r.inserted} aggiornati=${r.updated} ` +
          `chunk=${r.chunks} falliti=${r.failedChunks.length}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ orgId: org.id, error: msg });
      console.error(`[bisuite-scheduler] org=${org.id} (${org.name}) FAIL: ${msg}`);
    }
  }
  return { ok, failed };
}
