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

function extractSaleFields(sale: any, organizationId: string) {
  const bisuiteId = sale.id || sale.codiceEsterno || 0;
  const dataVenditaStr = sale.dataVendita || sale.createdAt;
  const dataVendita = dataVenditaStr ? new Date(dataVenditaStr) : null;

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
  inserted: number;
  totalFromApi: number;
}

/**
 * Esegue il fetch BiSuite per una singola organizzazione (stesso comportamento
 * dell'endpoint POST /api/bisuite-fetch): recupera tutte le vendite e
 * sostituisce in blocco le righe esistenti per l'org.
 *
 * Se `startDate`/`endDate` non sono passati, scarica tutto quello che l'API
 * BiSuite restituisce per l'org.
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

  const salesUrl = new URL(deriveSalesEndpoint(apiUrlStr));
  if (opts?.startDate) salesUrl.searchParams.set("from", opts.startDate);
  if (opts?.endDate) salesUrl.searchParams.set("to", opts.endDate);

  const salesResp = await fetch(salesUrl.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!salesResp.ok) {
    const body = await salesResp.text();
    throw new Error(`BiSuite API error (${salesResp.status}): ${body.slice(0, 300)}`);
  }
  const salesData: any = await salesResp.json();

  let sales: any[] = [];
  if (Array.isArray(salesData)) sales = salesData;
  else if (Array.isArray(salesData?.data)) sales = salesData.data;
  else if (Array.isArray(salesData?.vendite)) sales = salesData.vendite;
  else if (Array.isArray(salesData?.sales)) sales = salesData.sales;

  const records = sales.map((s) => extractSaleFields(s, orgId));
  await storage.deleteBisuiteSalesByOrg(orgId);
  const inserted = await storage.upsertBisuiteSales(records);

  return { orgId, inserted, totalFromApi: sales.length };
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
          `inserite ${r.inserted} / api ${r.totalFromApi}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ orgId: org.id, error: msg });
      console.error(`[bisuite-scheduler] org=${org.id} (${org.name}) FAIL: ${msg}`);
    }
  }
  return { ok, failed };
}
