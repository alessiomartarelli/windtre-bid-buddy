// Guardia anti-distruzione per la struttura organizzativa (Task #338).
//
// Incidente 13/08/2026: l'autosave del Simulatore (Preventivatore) ha
// sovrascritto organization_config.puntiVendita con PDV "scheletro"
// (nome/codicePos/ragioneSociale vuoti, id rigenerati), azzerando
// l'anagrafica reale di tutti i punti vendita di un'organizzazione.
// La write-protection esisteva solo per i ruoli non-admin.
//
// Questa logica è pura (nessun import di server/react) così può girare
// nei test tsx e essere condivisa tra server e (in futuro) client.

export type StrutturaPdvAnagrafica = {
  codicePos?: unknown;
  nome?: unknown;
  ragioneSociale?: unknown;
};

const isFilled = (v: unknown): boolean =>
  typeof v === "string" && v.trim() !== "";

/** true se il PDV ha almeno un campo anagrafico valorizzato. */
export function hasAnagrafica(p: unknown): boolean {
  if (!p || typeof p !== "object") return false;
  const o = p as StrutturaPdvAnagrafica;
  return isFilled(o.codicePos) || isFilled(o.nome) || isFilled(o.ragioneSociale);
}

/** Conta i PDV di un array (anche malformato) con anagrafica valorizzata. */
export function countPdvConAnagrafica(pdvs: unknown): number {
  if (!Array.isArray(pdvs)) return 0;
  let n = 0;
  for (const p of pdvs) if (hasAnagrafica(p)) n++;
  return n;
}

/**
 * true se la scrittura di `incoming` al posto di `current` azzererebbe in
 * massa l'anagrafica della struttura. Blocca due pattern, entrambi tipici
 * di uno stato wizard "scheletro" e mai di una modifica intenzionale:
 *   1) la config attuale ha almeno un PDV con anagrafica, quella in arrivo
 *      (presente ma) nessuno;
 *   2) l'array in arrivo contiene PDV scheletro (senza anagrafica) E il
 *      numero di PDV con anagrafica È DIMINUITO rispetto all'attuale
 *      (es. 1 riga compilata a metà + 12 scheletri al posto di 13 reali).
 *
 * Non blocca: aggiunte, modifiche/rinomine (stesso numero di PDV reali),
 * riduzioni fatte dagli endpoint dedicati (che non inviano scheletri), né
 * il caso in cui la chiave puntiVendita è assente o non-array nel payload
 * (gestito a parte con la re-iniezione del valore corrente).
 */
export function wouldMassBlankPuntiVendita(
  current: unknown,
  incoming: unknown,
): boolean {
  if (!Array.isArray(incoming)) return false;
  const curFilled = countPdvConAnagrafica(current);
  if (curFilled === 0) return false;
  const incFilled = countPdvConAnagrafica(incoming);
  if (incFilled === 0) return true;
  const hasScheletri = incoming.some(
    (p) => p !== null && typeof p === "object" && !hasAnagrafica(p),
  );
  return hasScheletri && incFilled < curFilled;
}
