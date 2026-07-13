// Genera shared/canvassCatalog.ts a partire dai due file Excel di riferimento
// forniti dall'utente (listino canvass + step di vendita Vodafone/Fastweb).
//
// È l'equivalente "import da Excel" riproducibile: rilanciando questo script
// dopo aver sostituito i file in attached_assets (nuovo mese/edizione) si
// rigenera il catalogo di default deployato. Legge i buffer con
// XLSX.read(buf,{type:"buffer"}) (XLSX.readFile non esiste in ESM/tsx).
//
// Uso: node scripts/generate-canvass-catalog.mjs
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const LISTINO =
  "attached_assets/listino_canvass_54027_LISTINO_CANVASS_VODAFONE_LUGLIO_2026_1783957283886.xlsx";
const STEP =
  "attached_assets/step_di_vendita_root_fastweb_vdf_13.07.26_1783957199618.xlsx";
const PERIODO = "LUGLIO 2026";
const OUT = "shared/canvassCatalog.ts";

function readRows(file) {
  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

// Deriva il brand dal nome della pista del listino. Le piste con "FASTWEB"
// nel nome sono Fastweb; tutte le altre (incl. VERISURE e ENERGIA VODAFONE)
// sono Vodafone.
function deriveBrand(pista) {
  return /FASTWEB/i.test(String(pista)) ? "fastweb" : "vodafone";
}

// offerId = i 5 caratteri centrali del codice CAN·····dddd (12 char).
function extractOfferId(codice) {
  const c = String(codice).toUpperCase().replace(/\s+/g, "");
  return /^CAN.{5}\d{4}$/.test(c) ? c.slice(3, 8) : null;
}

const listinoRows = readRows(LISTINO).filter((r) => String(r["CODICE"]).trim() !== "");
const offers = listinoRows.map((r) => {
  const codice = String(r["CODICE"]).toUpperCase().replace(/\s+/g, "");
  const canoneRaw = r["CANONE"];
  const canone =
    typeof canoneRaw === "number"
      ? canoneRaw
      : parseFloat(String(canoneRaw).replace(",", ".")) || 0;
  const pista = String(r["PISTA"]).trim();
  return {
    codice,
    offerId: extractOfferId(codice),
    nomeEtichetta: String(r["NOME ETICHETTA"]).trim(),
    pista,
    categoria: String(r["CATEGORIA"]).trim(),
    tipologia: String(r["TIPOLOGIA"]).trim(),
    canone,
    brand: deriveBrand(pista),
  };
});

const stepRows = readRows(STEP);
const steps = stepRows
  .filter((r) => String(r["Domanda"]).trim() !== "")
  .map((r) => ({
    externalId: r["ID"] === "" ? null : Number(r["ID"]),
    pistaAssociata: String(r["Pista Associata"]).trim(),
    pistaForm: String(r["Pista FORM"]).trim(),
    domanda: String(r["Domanda"]).trim(),
    ordine: r["Ordine"] === "" ? null : Number(r["Ordine"]),
    attivo: String(r["ATTIVO"]).trim().toUpperCase() === "S",
    brand: String(r["Brand"]).trim(),
  }));

const banner =
  "// GENERATO AUTOMATICAMENTE da scripts/generate-canvass-catalog.mjs — NON modificare a mano.\n" +
  `// Fonte: ${path.basename(LISTINO)}\n` +
  `//        ${path.basename(STEP)}\n`;

const body =
  banner +
  'import type { CanvassReference } from "./canvassMapping";\n\n' +
  "export const CANVASS_CATALOG: CanvassReference = " +
  JSON.stringify({ periodo: PERIODO, offers, steps }, null, 2) +
  ";\n";

fs.writeFileSync(OUT, body);
console.log(
  `Scritto ${OUT}: ${offers.length} offerte, ${steps.length} step (periodo ${PERIODO}).`,
);
