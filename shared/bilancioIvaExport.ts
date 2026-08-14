// ── Foglio "Bilancio IVA" per l'export Excel della Prima Nota IVA (Task #365) ──
// Logica pura (senza dipendenze da React/xlsx) così i test tsx possono
// verificarla direttamente, come da convenzione shared/ del progetto.
//
// Il foglio replica la card "Bilancio IVA": per ogni Ragione Sociale
// IVA a debito (imposta vendite), IVA a credito (spese CdG) e saldo,
// più una riga TOTALE. Se il credito non è disponibile (modulo CdG non
// accessibile o errore di caricamento) le colonne credito/saldo restano
// vuote e viene aggiunta una riga NOTA esplicita: mai esportare uno
// zero silenzioso che gonfierebbe il saldo.

export interface BilancioIvaRow {
  rs: string;
  debito: number;
  credito: number;
  saldo: number;
}

export interface BilancioIvaTot {
  debito: number;
  credito: number;
  saldo: number;
}

/** Stato del caricamento del credito IVA (spese CdG). */
export type CreditoStatus = "ok" | "no_access" | "error";

export interface BilancioIvaExportRow {
  "Ragione Sociale": string;
  "IVA a Debito (vendite)": number | string;
  "IVA a Credito (spese CdG)": number | string;
  "Saldo": number | string;
}

export const BILANCIO_IVA_SHEET_NAME = "Bilancio IVA";

export const CREDITO_NOTE: Record<Exclude<CreditoStatus, "ok">, string> = {
  no_access:
    "NOTA: IVA a credito non disponibile (modulo Controllo di Gestione non accessibile). Il saldo non include il credito da spese.",
  error:
    "NOTA: IVA a credito non disponibile (errore nel caricamento delle spese CdG). Riprova l'export dopo aver ricaricato la pagina.",
};

/**
 * Costruisce le righe del foglio "Bilancio IVA".
 * - status "ok": debito/credito/saldo numerici + riga TOTALE.
 * - status "no_access"/"error": solo debito numerico; credito e saldo vuoti
 *   (anche nel TOTALE) + riga NOTA finale che spiega perché.
 */
export function buildBilancioIvaSheet(
  rows: BilancioIvaRow[],
  tot: BilancioIvaTot,
  status: CreditoStatus,
): BilancioIvaExportRow[] {
  const creditoOk = status === "ok";
  const out: BilancioIvaExportRow[] = rows.map((r) => ({
    "Ragione Sociale": r.rs,
    "IVA a Debito (vendite)": r.debito,
    "IVA a Credito (spese CdG)": creditoOk ? r.credito : "",
    "Saldo": creditoOk ? r.saldo : "",
  }));
  out.push({
    "Ragione Sociale": "TOTALE",
    "IVA a Debito (vendite)": tot.debito,
    "IVA a Credito (spese CdG)": creditoOk ? tot.credito : "",
    "Saldo": creditoOk ? tot.saldo : "",
  });
  if (!creditoOk) {
    out.push({
      "Ragione Sociale": CREDITO_NOTE[status],
      "IVA a Debito (vendite)": "",
      "IVA a Credito (spese CdG)": "",
      "Saldo": "",
    });
  }
  return out;
}
