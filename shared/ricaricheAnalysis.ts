import * as XLSX from "xlsx";
import { isVfBrandName, isWindtreBrandName } from "./modules";

export const RICARICHE_ANALYSIS_PROVIDER = "vodafone_fastweb" as const;
export const RICARICHE_ANALYSIS_PROVIDERS = ["vodafone_fastweb", "windtre"] as const;
export type RechargeAnalysisProvider = (typeof RICARICHE_ANALYSIS_PROVIDERS)[number];
export const RICARICHE_ANALYSIS_STATUSES = [
  "VERIFICATO",
  "INCONGRUENZA IMPORTO",
  "NON PRESENTE SU BISUITE",
  "NON PRESENTE SU FILE",
  "FUORI PERIODO",
  "RICEVUTA VIA API",
] as const;

export type RechargeAnalysisStatus = (typeof RICARICHE_ANALYSIS_STATUSES)[number];

/**
 * Provider visibili all'organizzazione. I tenant senza brand mantengono il
 * comportamento VF storico; con brand associati, ogni provider richiede il
 * relativo brand e quelli sconosciuti non ricevono dati di ricariche.
 */
export function getRicaricheAnalysisProvidersForBrands(
  brandNames: string[] | null | undefined,
): RechargeAnalysisProvider[] {
  if (!brandNames?.length) return ["vodafone_fastweb"];
  const providers: RechargeAnalysisProvider[] = [];
  if (brandNames.some(isVfBrandName)) providers.push("vodafone_fastweb");
  if (brandNames.some(isWindtreBrandName)) providers.push("windtre");
  return providers;
}

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
  /** Identità della singola ricarica, distinta dall'ID vendita mostrato. */
  candidateId?: string;
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
  fileDate: string | null;
  bisuiteDate: string | null;
  phone: string | null;
  temporaryPhone: string | null;
  amount: number | null;
  customer: string | null;
  supplier: string | null;
  transactionId: string | null;
  rechargeType: string | null;
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

export function normalizeRechargeSupplier(value: unknown): string {
  const supplier = text(value);
  return supplier.toLocaleLowerCase("it") === "vodafone store" ? "Vodafone" : supplier;
}

export function rechargeReportOverlapsPeriod(
  report: {
    periodFrom: string | null;
    periodTo: string | null;
    declaredPeriodFrom?: string | null;
    declaredPeriodTo?: string | null;
  },
  from?: string,
  to?: string,
): boolean {
  if (!from && !to) return true;
  const periodFrom = report.declaredPeriodFrom && report.declaredPeriodTo
    ? report.declaredPeriodFrom.slice(0, 10)
    : report.periodFrom?.slice(0, 10);
  const periodTo = report.declaredPeriodFrom && report.declaredPeriodTo
    ? report.declaredPeriodTo.slice(0, 10)
    : report.periodTo?.slice(0, 10);
  if (!periodFrom || !periodTo) return false;
  return (!from || periodTo >= from) && (!to || periodFrom <= to);
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
      supplier: prev?.supplier || normalizeRechargeSupplier(columns.supplier >= 0 ? row[columns.supplier] : ""),
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

/**
 * Report WindTre ricariche (foglio Report): ogni Keycode è una transazione.
 * Codice Ordine identifica un batch che può attraversare date e PDV diversi,
 * perciò non va usato come chiave di aggregazione.
 */
export function parseWindTreRechargeWorkbook(bytes: Uint8Array): RechargeProviderRow[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "array", cellDates: true });
  } catch {
    throw new Error("Il file non è un Excel leggibile. Seleziona un report ricariche WindTre valido.");
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error("Il file Excel non contiene fogli leggibili.");
  const source = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
  if (source.length < 2) throw new Error("Il foglio Excel non contiene righe di ricariche WindTre.");

  const headers = source[0].map(normalizedHeader);
  const columns = {
    orderCode: getColumn(headers, "Codice Ordine"),
    transactionId: getColumn(headers, "Keycode"),
    phone: getColumn(headers, "MSISDN"),
    amount: getColumn(headers, "Taglio ricarica"),
    rechargeType: getColumn(headers, "Tipo ricarica"),
    status: getColumn(headers, "Stato"),
    date: getColumn(headers, "Data utilizzo"),
    pointId: getColumn(headers, "PDV"),
  };
  const required = [
    ["Codice Ordine", columns.orderCode],
    ["Keycode", columns.transactionId],
    ["MSISDN", columns.phone],
    ["Taglio ricarica", columns.amount],
    ["Tipo ricarica", columns.rechargeType],
    ["Stato", columns.status],
    ["Data utilizzo", columns.date],
    ["PDV", columns.pointId],
  ] as const;
  const missing = required.filter(([, index]) => index < 0).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Formato report WindTre non riconosciuto: colonne obbligatorie mancanti (${missing.join(", ")}).`);
  }

  const grouped = new Map<string, RechargeProviderRow>();
  for (const row of source.slice(1)) {
    if (!row.some((cell) => text(cell))) continue;
    const status = normalizedHeader(row[columns.status]);
    // Nel tracciato reale tutte le righe sono BURNED. Non importare stati
    // diversi senza prima averne verificato il significato nel report.
    if (status !== "BURNED") {
      throw new Error(`Stato WindTre non supportato per il Keycode ${text(row[columns.transactionId])}: ${status || "vuoto"}.`);
    }

    const transactionId = text(row[columns.transactionId]);
    if (!transactionId) throw new Error("Il report WindTre contiene una riga BURNED senza Keycode.");
    const date = excelDate(row[columns.date]);
    const amount = parseRechargeAmount(row[columns.amount]);
    const phone = normalizeRechargePhone(row[columns.phone]);
    const orderCode = text(row[columns.orderCode]);
    const pointId = text(row[columns.pointId]);
    const rechargeType = text(row[columns.rechargeType]);
    if (!date || amount === null || amount < 0 || !phone || !orderCode || !pointId || !rechargeType) {
      throw new Error(`Riga WindTre con data, importo, numero o riferimenti non validi per il Keycode ${transactionId}.`);
    }

    const prev = grouped.get(transactionId);
    if (prev && (prev.date.slice(0, 10) !== date.slice(0, 10) || !prev.phoneCandidates.includes(phone))) {
      throw new Error(`Il Keycode WindTre ${transactionId} è associato a date o numeri diversi.`);
    }
    const totalCents = Math.round(amount * 100) + Math.round((prev?.amount ?? 0) * 100);
    grouped.set(transactionId, {
      id: transactionId,
      date: prev && prev.date < date ? prev.date : date,
      phone: prev?.phone || phone,
      temporaryPhone: "",
      phoneCandidates: Array.from(new Set([...(prev?.phoneCandidates ?? []), phone])),
      amount: totalCents / 100,
      customer: "",
      supplier: "WindTre",
      transactionId,
      dealerCode: prev?.dealerCode || orderCode,
      pointId: prev?.pointId || pointId,
      rechargeType: prev?.rechargeType || rechargeType,
      rowCount: (prev?.rowCount ?? 0) + 1,
    });
  }
  if (grouped.size === 0) throw new Error("Nessuna ricarica WindTre utilizzata trovata nel report.");
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
    // BiSuite reale salva le risposte anche come testo etichettato nei campi
    // venditaInfoN, con domandeRisposte vuoto. Non interpretare numeri liberi
    // (es. ICCID, codici o importi) come telefoni.
    if (/^venditaInfo[1-5]$/.test(key) && typeof child === "string") {
      const match = child.match(/^\s*(?:numero\s+(?:di\s+)?telefono(?:\s+da\s+ricaricare)?|msisdn|cellulare|utenza)\s*:\s*([+\d][\d\s()./-]*)\s*$/i);
      if (match) {
        const phone = normalizeRechargePhone(match[1]);
        if (phone.length >= 8) output.add(phone);
      }
    }
    if (/(telefon|cellulare|utenza|msisdn|numero.*ricar)/i.test(key)) {
      const phone = normalizeRechargePhone(child);
      if (phone.length >= 8) output.add(phone);
    }
    if (key.toLowerCase() === "venditainfo1" && typeof child === "string") {
      // In BiSuite RICARICHE, the destination number is sometimes stored as
      // free text in dettaglio.venditaInfo1 (e.g. "Numero Telefono: ...").
      // Require an explicit telephone label to avoid interpreting unrelated
      // digits in this generic field as a phone number.
      const labeled = child.match(
        /(?:numero|utenza|msisdn)\s*(?:di\s*)?(?:telefono|cellulare|ricarica)\s*[:=]\s*(.+)$/i,
      );
      if (labeled) {
        const phone = normalizeRechargePhone(labeled[1]);
        if (phone.length >= 8 && phone.length <= 12) output.add(phone);
      }
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

/** Compara giorni ISO inclusivi senza dipendere dal fuso orario del browser/server. */
export function isRechargeDateWithinPeriod(value: unknown, from: string, to: string): boolean {
  const day = dateKey(value);
  return !!day && day >= from && day <= to;
}

export function rowsOutsideRechargePeriod(
  rows: RechargeProviderRow[],
): RechargeReconciliationRow[] {
  return reconcileRechargeRows(rows, [], { includeUnmatchedSales: false })
    .map((row) => ({ ...row, status: "FUORI PERIODO" }));
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
}>, options: { splitArticles?: boolean } = {}): RechargeSaleCandidate[] {
  const out: RechargeSaleCandidate[] = [];
  for (const sale of sales) {
    if ((sale.stato ?? "").trim().toUpperCase() === "ANNULLATA") continue;
    const raw = sale.rawData && typeof sale.rawData === "object" ? sale.rawData as Record<string, unknown> : {};
    const articles = Array.isArray(raw.articoli) ? raw.articoli as Array<Record<string, any>> : [];
    const rechargeArticles = articles.filter((article) =>
      text(article?.categoria?.nome).toUpperCase() === "RICARICHE",
    );
    if (!rechargeArticles.length) continue;
    // WindTre: una Keycode per ricarica, anche se lo scontrino contiene più
    // ricariche sullo stesso numero o su numeri diversi. VF conserva il
    // raggruppamento storico per vendita/transazione.
    const groups = options.splitArticles ? rechargeArticles.map(article => [article]) : [rechargeArticles];
    for (const [index, group] of groups.entries()) {
      const phones = new Set<string>();
      let amountCents = 0;
      for (const article of group) {
        collectPhones(article, phones);
        const amount = parseRechargeAmount(article?.dettaglio?.prezzo ?? article?.dettaglio?.importo ?? article?.prezzo);
        if (amount !== null) amountCents += Math.round(amount * 100);
      }
      if (amountCents <= 0) continue;
      out.push({
        ...(options.splitArticles ? { candidateId: `${sale.bisuiteId}:article:${index}` } : {}),
        saleId: String(sale.bisuiteId),
        bisuiteId: sale.bisuiteId,
        date: dateKey(sale.dataVendita),
        pdv: text(sale.codicePos) || text(sale.nomeNegozio),
        customer: text(sale.nomeCliente),
        amount: amountCents / 100,
        phones: Array.from(phones),
      });
    }
  }
  return out;
}

/**
 * Compatibilità con report salvati quando le righe ripetute non erano ancora
 * accorpate in importazione. La transazione provider resta l'unità di match.
 */
function aggregateProviderRowsByTransaction(rows: RechargeProviderRow[]): RechargeProviderRow[] {
  const grouped = new Map<string, RechargeProviderRow>();
  for (const row of rows) {
    const transactionId = text(row.transactionId);
    const previous = grouped.get(transactionId);
    if (!previous) {
      grouped.set(transactionId, {
        ...row,
        phoneCandidates: Array.from(new Set([
          ...(row.phoneCandidates ?? []),
          row.phone,
          row.temporaryPhone,
        ].map(normalizeRechargePhone).filter(Boolean))),
      });
      continue;
    }
    const totalCents = Math.round(previous.amount * 100) + Math.round(row.amount * 100);
    grouped.set(transactionId, {
      ...previous,
      date: previous.date < row.date ? previous.date : row.date,
      phone: previous.phone || row.phone,
      temporaryPhone: previous.temporaryPhone || row.temporaryPhone,
      phoneCandidates: Array.from(new Set([
        ...previous.phoneCandidates,
        ...(row.phoneCandidates ?? []),
        row.phone,
        row.temporaryPhone,
      ].map(normalizeRechargePhone).filter(Boolean))),
      amount: totalCents / 100,
      rowCount: (previous.rowCount ?? 1) + (row.rowCount ?? 1),
    });
  }
  return Array.from(grouped.values());
}

/**
 * Abbina una sola transazione fornitore a ogni candidato BiSuite al massimo
 * (singola ricarica WindTre o vendita aggregata VF).
 * Prima abbina giorno e numero; per VF è possibile un secondo passaggio sui
 * numeri rimasti anche con date diverse. Ogni vendita viene consumata una volta.
 */
export function reconcileRechargeRows(
  providerRows: RechargeProviderRow[],
  sales: RechargeSaleCandidate[],
  options: { includeUnmatchedSales?: boolean; allowDateMismatch?: boolean } = {},
): RechargeReconciliationRow[] {
  const transactions = aggregateProviderRowsByTransaction(providerRows);
  const candidateKey = (sale: RechargeSaleCandidate) => sale.candidateId ?? sale.saleId;
  const remainingSales = new Set(sales.map(candidateKey));
  const assignments = new Map<string, RechargeSaleCandidate>();
  const providerDay = (row: RechargeProviderRow) => row.date.slice(0, 10);
  const canMatch = (row: RechargeProviderRow, sale: RechargeSaleCandidate, allowDateMismatch: boolean) =>
    (allowDateMismatch || sale.date === providerDay(row)) &&
    sale.phones.some((phone) => row.phoneCandidates.includes(phone));
  const dayDistance = (a: string, b: string) => {
    const aTime = Date.parse(`${a}T00:00:00.000Z`);
    const bTime = Date.parse(`${b}T00:00:00.000Z`);
    return Number.isFinite(aTime) && Number.isFinite(bTime)
      ? Math.abs(aTime - bTime)
      : Number.MAX_SAFE_INTEGER;
  };
  const assign = (allowDateMismatch: boolean) => {
    const ordered = transactions.filter(row => !assignments.has(row.transactionId)).sort((a, b) => {
      const candidatesA = sales.filter((sale) => remainingSales.has(candidateKey(sale)) && canMatch(a, sale, allowDateMismatch)).length;
      const candidatesB = sales.filter((sale) => remainingSales.has(candidateKey(sale)) && canMatch(b, sale, allowDateMismatch)).length;
      return candidatesA - candidatesB || a.transactionId.localeCompare(b.transactionId);
    });
    for (const row of ordered) {
      const candidates = sales.filter((sale) =>
        remainingSales.has(candidateKey(sale)) &&
        canMatch(row, sale, allowDateMismatch),
      );
      candidates.sort((a, b) =>
        Math.abs(a.amount - row.amount) - Math.abs(b.amount - row.amount) ||
        dayDistance(a.date, providerDay(row)) - dayDistance(b.date, providerDay(row)) ||
        a.saleId.localeCompare(b.saleId, undefined, { numeric: true }),
      );
      if (candidates[0]) {
        assignments.set(row.transactionId, candidates[0]);
        remainingSales.delete(candidateKey(candidates[0]));
      }
    }
  };
  assign(false);
  if (options.allowDateMismatch) assign(true);

  const result: RechargeReconciliationRow[] = transactions.map((row) => {
    const sale = assignments.get(row.transactionId);
    const difference = sale ? Math.round((sale.amount - row.amount) * 100) / 100 : null;
    return {
      id: `provider:${row.transactionId}`,
      date: row.date,
      fileDate: row.date,
      bisuiteDate: sale?.date ?? null,
      phone: row.phone || null,
      temporaryPhone: row.temporaryPhone || null,
      amount: row.amount,
      customer: sale?.customer || row.customer || null,
      supplier: normalizeRechargeSupplier(row.supplier) || "Vodafone/Fastweb",
      transactionId: row.transactionId,
      rechargeType: row.rechargeType || null,
      pdv: sale?.pdv || (row.supplier === "WindTre" ? row.pointId : "") || null,
      saleId: sale?.saleId || null,
      bisuiteAmount: sale?.amount ?? null,
      difference,
      status: !sale ? "NON PRESENTE SU BISUITE" : difference === 0 ? "VERIFICATO" : "INCONGRUENZA IMPORTO",
    };
  });
  for (const sale of options.includeUnmatchedSales === false ? [] : sales) {
    if (!remainingSales.has(candidateKey(sale))) continue;
    result.push({
      id: `bisuite:${candidateKey(sale)}`,
      date: sale.date,
      fileDate: null,
      bisuiteDate: sale.date,
      phone: sale.phones[0] || null,
      temporaryPhone: null,
      amount: null,
      customer: sale.customer || null,
      supplier: null,
      transactionId: null,
      rechargeType: null,
      pdv: sale.pdv || null,
      saleId: sale.saleId,
      bisuiteAmount: sale.amount,
      difference: null,
      status: "NON PRESENTE SU FILE",
    });
  }
  return result.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/** Rows for BiSuite-synced recharge sales when no provider report is selected. */
export function rechargeApiRows(sales: RechargeSaleCandidate[]): RechargeReconciliationRow[] {
  return sales.map((sale) => ({
    id: `bisuite-api:${sale.candidateId ?? sale.saleId}`,
    date: sale.date,
    fileDate: null,
    bisuiteDate: sale.date,
    phone: sale.phones.join(", ") || null,
    temporaryPhone: null,
    amount: null,
    customer: sale.customer || null,
    supplier: "BiSuite API",
    transactionId: null,
    rechargeType: "RICARICHE",
    pdv: sale.pdv || null,
    saleId: sale.saleId,
    bisuiteAmount: sale.amount,
    difference: null,
    status: "RICEVUTA VIA API",
  }));
}
