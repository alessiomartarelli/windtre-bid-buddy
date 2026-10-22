import * as XLSX from "xlsx";

export const RICARICHE_ANALYSIS_PROVIDER = "vodafone_fastweb" as const;
export const RICARICHE_ANALYSIS_STATUSES = [
  "VERIFICATO",
  "INCONGRUENZA IMPORTO",
  "NON PRESENTE SU BISUITE",
  "NON PRESENTE SU FILE",
] as const;

export type RechargeAnalysisStatus = (typeof RICARICHE_ANALYSIS_STATUSES)[number];

export interface RechargeProviderRow {
  id: string;
  date: string;
  phone: string;
  temporaryPhone: string;
  phoneCandidates: string[];
  amount: number;
  customer: string;
  supplier: string;
  transactionId: string;
  dealerCode: string;
  pointId: string;
  rechargeType: string;
  rowCount: number;
}

export interface RechargeSaleCandidate {
  saleId: string;
  bisuiteId: number;
  date: string;
  pdv: string;
  customer: string;
  amount: number;
  phones: string[];
}

export interface RechargeReconciliationRow {
  id: string;
  date: string;
  phone: string | null;
  temporaryPhone: string | null;
  amount: number | null;
  customer: string | null;
  supplier: string | null;
  transactionId: string | null;
  pdv: string | null;
  saleId: string | null;
  bisuiteAmount: number | null;
  difference: number | null;
  status: RechargeAnalysisStatus;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeRechargePhone(value: unknown): string {
  let digits = text(value).replace(/\D/g, "");
  if (digits.startsWith("0039")) digits = digits.slice(4);
  else if (digits.startsWith("39") && digits.length > 10) digits = digits.slice(2);
  return digits;
}

function parseRechargeAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100) / 100;
  let raw = text(value).replace(/[€\s]/g, "").replace(/[^\d,.-]/g, "");
  if (!raw) return null;
  if (raw.includes(",") && raw.includes(".")) {
    raw = raw.lastIndexOf(",") > raw.lastIndexOf(".")
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (raw.includes(",")) {
    raw = raw.replace(",", ".");
  }
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function excelDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S));
    return date.toISOString();
  }
  const raw = text(value);
  const it = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (it) {
    let year = Number(it[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const date = new Date(Date.UTC(year, Number(it[2]) - 1, Number(it[1]), Number(it[4] || 0), Number(it[5] || 0), Number(it[6] || 0)));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== Number(it[2]) - 1 || date.getUTCDate() !== Number(it[1])) return null;
    return date.toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizedHeader(value: unknown): string {
  return text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function getColumn(headers: string[], exact: string, includes?: string): number {
  const target = normalizedHeader(exact);
  let index = headers.findIndex((header) => header === target);
  if (index < 0 && includes) {
    const needle = normalizedHeader(includes);
    index = headers.findIndex((header) => header.includes(needle));
  }
  return index;
}

/**
 * Legge il tracciato Vodafone/Fastweb ufficiale e accorpa tutte le righe con
 * lo stesso ID transazione, sommando gli importi senza errori di precisione.
 */
export function parseVodafoneRechargeWorkbook(bytes: Uint8Array): RechargeProviderRow[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "array", cellDates: true });
  } catch {
    throw new Error("Il file non è un Excel leggibile. Seleziona un report Vodafone/Fastweb valido.");
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error("Il file Excel non contiene fogli leggibili.");
  const source = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
  if (source.length < 2) throw new Error("Il foglio Excel non contiene righe di ricariche.");

  const headers = source[0].map(normalizedHeader);
  const columns = {
    date: getColumn(headers, "Ora di Ricarica", "RICARICA"),
    phone: getColumn(headers, "Numero Telefono"),
    temporaryPhone: getColumn(headers, "Numero Telefono Temporaneo"),
    amount: getColumn(headers, "Importo Ricarica", "IMPORTO"),
    transactionId: getColumn(headers, "ID Transazione"),
    supplier: getColumn(headers, "Canale di Vendite SAP", "CANALE"),
    dealerCode: getColumn(headers, "Codice Dealer"),
    pointId: getColumn(headers, "ID Point"),
    rechargeType: getColumn(headers, "Tipologia Ricarica"),
  };
  const required = [
    ["Ora di Ricarica", columns.date],
    ["Numero Telefono", columns.phone],
    ["Importo Ricarica", columns.amount],
    ["ID Transazione", columns.transactionId],
  ] as const;
  const missing = required.filter(([, index]) => index < 0).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Formato report non riconosciuto: colonne obbligatorie mancanti (${missing.join(", ")}). Il parser supporta il tracciato Vodafone/Fastweb, non WindTre.`);
  }

  const grouped = new Map<string, RechargeProviderRow>();
  for (const row of source.slice(1)) {
    if (!row.some((cell) => text(cell))) continue;
    const transactionId = text(row[columns.transactionId]);
    if (!transactionId) throw new Error("Il report contiene una riga valorizzata senza ID Transazione; correggi il file e ricaricalo.");
    const date = excelDate(row[columns.date]);
    const amount = parseRechargeAmount(row[columns.amount]);
    const phone = normalizeRechargePhone(row[columns.phone]);
    const temporaryPhone = normalizeRechargePhone(columns.temporaryPhone >= 0 ? row[columns.temporaryPhone] : "");
    if (!date || amount === null || amount < 0 || (!phone && !temporaryPhone)) {
      throw new Error(`Riga con data, importo o numero non valido per la transazione ${transactionId}.`);
    }
    const key = transactionId;
    const prev = grouped.get(key);
    const phoneCandidates = Array.from(new Set([...(prev?.phoneCandidates ?? []), phone, temporaryPhone].filter(Boolean)));
    const totalCents = Math.round(amount * 100) + Math.round((prev?.amount ?? 0) * 100);
    grouped.set(key, {
      id: key,
      date: prev && prev.date < date ? prev.date : date,
      phone: prev?.phone || phone,
      temporaryPhone: prev?.temporaryPhone || temporaryPhone,
      phoneCandidates,
      amount: totalCents / 100,
      // Il campo Login è l'utente del dealer, non il nominativo del cliente.
      // Il nominativo viene mostrato solo quando proviene dalla vendita BiSuite.
      customer: "",
      supplier: prev?.supplier || text(columns.supplier >= 0 ? row[columns.supplier] : ""),
      transactionId,
      dealerCode: prev?.dealerCode || text(columns.dealerCode >= 0 ? row[columns.dealerCode] : ""),
      pointId: prev?.pointId || text(columns.pointId >= 0 ? row[columns.pointId] : ""),
      rechargeType: prev?.rechargeType || text(columns.rechargeType >= 0 ? row[columns.rechargeType] : ""),
      rowCount: (prev?.rowCount ?? 0) + 1,
    });
  }
  if (grouped.size === 0) throw new Error("Nessuna ricarica valida trovata nel report.");
  return Array.from(grouped.values()).sort((a, b) => a.date.localeCompare(b.date) || a.transactionId.localeCompare(b.transactionId));
}

function collectPhones(value: unknown, output: Set<string>, parentKey = ""): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        const question = `${text(record.domandaTesto)} ${text(record.domanda)} ${parentKey}`.toLowerCase();
        if (/(telefon|cellulare|utenza|msisdn|numero.*ricar)/i.test(question)) {
          const answer = normalizeRechargePhone(record.risposta);
          if (answer.length >= 8) output.add(answer);
        }
        collectPhones(record, output, parentKey);
      }
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/(telefon|cellulare|utenza|msisdn|numero.*ricar)/i.test(key)) {
      const phone = normalizeRechargePhone(child);
      if (phone.length >= 8) output.add(phone);
    }
    if (child && typeof child === "object") collectPhones(child, output, key);
  }
}

function dateKey(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value);
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

export function extractRechargeSales(sales: Array<{
  id: string;
  bisuiteId: number;
  dataVendita: Date | string | null;
  codicePos: string | null;
  nomeNegozio: string | null;
  nomeCliente: string | null;
  stato: string | null;
  rawData: unknown;
}>): RechargeSaleCandidate[] {
  const out: RechargeSaleCandidate[] = [];
  for (const sale of sales) {
    if ((sale.stato ?? "").trim().toUpperCase() === "ANNULLATA") continue;
    const raw = sale.rawData && typeof sale.rawData === "object" ? sale.rawData as Record<string, unknown> : {};
    const articles = Array.isArray(raw.articoli) ? raw.articoli as Array<Record<string, any>> : [];
    const rechargeArticles = articles.filter((article) =>
      text(article?.categoria?.nome).toUpperCase() === "RICARICHE",
    );
    if (!rechargeArticles.length) continue;
    const phones = new Set<string>();
    let amountCents = 0;
    for (const article of rechargeArticles) {
      collectPhones(article, phones);
      const amount = parseRechargeAmount(article?.dettaglio?.prezzo ?? article?.dettaglio?.importo ?? article?.prezzo);
      if (amount !== null) amountCents += Math.round(amount * 100);
    }
    if (amountCents <= 0) continue;
    out.push({
      saleId: String(sale.bisuiteId),
      bisuiteId: sale.bisuiteId,
      date: dateKey(sale.dataVendita),
      pdv: text(sale.codicePos) || text(sale.nomeNegozio),
      customer: text(sale.nomeCliente),
      amount: amountCents / 100,
      phones: Array.from(phones),
    });
  }
  return out;
}

/**
 * Abbina una sola transazione fornitore a ogni vendita BiSuite al massimo.
 * Una corrispondenza richiede giorno e numero; tra più candidati si preferisce
 * l'importo più vicino, mantenendo deterministico il risultato.
 */
export function reconcileRechargeRows(
  providerRows: RechargeProviderRow[],
  sales: RechargeSaleCandidate[],
): RechargeReconciliationRow[] {
  const remainingSales = new Set(sales.map((sale) => sale.saleId));
  const assignments = new Map<string, RechargeSaleCandidate>();
  const ordered = [...providerRows].sort((a, b) => {
    const candidatesA = sales.filter((sale) => sale.date === a.date && sale.phones.some((phone) => a.phoneCandidates.includes(phone))).length;
    const candidatesB = sales.filter((sale) => sale.date === b.date && sale.phones.some((phone) => b.phoneCandidates.includes(phone))).length;
    return candidatesA - candidatesB || a.transactionId.localeCompare(b.transactionId);
  });
  for (const row of ordered) {
    const candidates = sales.filter((sale) =>
      remainingSales.has(sale.saleId) &&
      sale.date === row.date.slice(0, 10) &&
      sale.phones.some((phone) => row.phoneCandidates.includes(phone)),
    );
    candidates.sort((a, b) =>
      Math.abs(a.amount - row.amount) - Math.abs(b.amount - row.amount) ||
      a.saleId.localeCompare(b.saleId, undefined, { numeric: true }),
    );
    if (candidates[0]) {
      assignments.set(row.transactionId, candidates[0]);
      remainingSales.delete(candidates[0].saleId);
    }
  }

  const result: RechargeReconciliationRow[] = providerRows.map((row) => {
    const sale = assignments.get(row.transactionId);
    const difference = sale ? Math.round((sale.amount - row.amount) * 100) / 100 : null;
    return {
      id: `provider:${row.transactionId}`,
      date: row.date,
      phone: row.phone || null,
      temporaryPhone: row.temporaryPhone || null,
      amount: row.amount,
      customer: sale?.customer || row.customer || null,
      supplier: row.supplier || "Vodafone/Fastweb",
      transactionId: row.transactionId,
      pdv: sale?.pdv || null,
      saleId: sale?.saleId || null,
      bisuiteAmount: sale?.amount ?? null,
      difference,
      status: !sale ? "NON PRESENTE SU BISUITE" : difference === 0 ? "VERIFICATO" : "INCONGRUENZA IMPORTO",
    };
  });
  for (const sale of sales) {
    if (!remainingSales.has(sale.saleId)) continue;
    result.push({
      id: `bisuite:${sale.saleId}`,
      date: sale.date,
      phone: sale.phones[0] || null,
      temporaryPhone: null,
      amount: null,
      customer: sale.customer || null,
      supplier: null,
      transactionId: null,
      pdv: sale.pdv || null,
      saleId: sale.saleId,
      bisuiteAmount: sale.amount,
      difference: null,
      status: "NON PRESENTE SU FILE",
    });
  }
  return result.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
