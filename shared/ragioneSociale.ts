// Normalizzazione e risoluzione alias delle Ragioni Sociali (Task #367).
//
// Un'unica normalizzazione condivisa client+server: varianti banali come
// "CMS SRL" vs "CMS S.R.L" o spazi doppi/maiuscole diverse producono la
// stessa chiave. Gli alias espliciti (registro cdg_ragioni_sociali.alias)
// coprono le varianti semantiche ("CMS Evo S.R.L" → "CMS Evolution Srl").
//
// La risoluzione avviene SOLO in lettura/aggregazione: i dati storici non
// vengono mai riscritti, quindi rimuovere un alias riseparara i gruppi.

/** Chiave normalizzata: trim, rimozione punti, collasso spazi, uppercase. */
export function normalizeRsName(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export type RsRegistryEntry = { nome: string; alias?: string[] | null };

/**
 * Costruisce un resolver nome grezzo → nome canonico a partire dal registro
 * RS (nomi canonici + alias). Un nome viene mappato al canonico se la sua
 * chiave normalizzata coincide con quella del nome canonico o di un alias;
 * altrimenti resta invariato (trimmato).
 * I nomi canonici hanno precedenza sugli alias (un alias che collide con un
 * canonico non può "rubare" il nome di un'altra RS).
 */
export function buildRsResolver(entries: RsRegistryEntry[]): (raw: string | null | undefined) => string {
  const map = new Map<string, string>();
  // Prima gli alias, poi i canonici in modalità set-se-assente: così un
  // anchor 'auto' omonimo di un alias (la variante stessa, registrata come
  // portatore di id) non "ruba" la risoluzione all'alias. La validazione
  // server impedisce che un alias collida col nome di una RS manuale.
  for (const e of entries) {
    for (const a of e.alias ?? []) {
      const k = normalizeRsName(a);
      if (k && !map.has(k)) map.set(k, e.nome);
    }
  }
  for (const e of entries) {
    const k = normalizeRsName(e.nome);
    if (k && !map.has(k)) map.set(k, e.nome);
  }
  return (raw) => {
    const display = String(raw ?? "").trim();
    if (!display) return display;
    return map.get(normalizeRsName(display)) ?? display;
  };
}
