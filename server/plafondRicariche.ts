// Task #537/#538 — Plafond ricariche per Ragione Sociale.
//
// Calcolo condiviso dei saldi plafond (routes + report Telegram). Il saldo è
// sempre DERIVATO dalle operazioni admin append-only + il consumo RICARICHE
// (vendite non annullate), mai un contatore decrementato.
//
// Task #538 — soglia di avviso per RS: operazione append-only 'soglia'
// (vince l'ultima registrata; importo 0 = soglia disattivata). Una RS è
// "in allerta" quando il saldo è negativo oppure sotto la soglia configurata.
import { storage } from "./storage";
import { cdgStorage } from "./cdgStorage";

// Soglia di avviso di default (in €) quando l'admin non ne ha configurata
// una per la RS: il plafond è configurato ma la soglia no ⇒ avvisa comunque
// quando il saldo scende sotto questo valore (oltre che quando è negativo).
export const PLAFOND_SOGLIA_DEFAULT = 50;

export type PlafondSaldo = {
  ragioneSocialeId: string;
  ragioneSociale: string;
  saldo: number | null;          // null = plafond mai configurato per la RS
  consumoTotale: number;         // consumo ricariche complessivo (info)
  consumoDaCutoff: number;       // consumo conteggiato nel saldo corrente
  // Soglia di avviso effettiva: quella configurata per la RS, altrimenti il
  // default di sistema (solo se il plafond è configurato). null = nessun
  // avviso sotto-soglia possibile (plafond non configurato o soglia a 0
  // esplicita, dove resta solo l'allerta per saldo negativo).
  soglia: number | null;
  sogliaCustom: boolean;         // true se la soglia viene da un'op 'soglia'
  // true quando saldo < 0 oppure saldo < soglia: la UI e il report Telegram
  // usano SOLO questo flag, così la regola resta in un posto solo.
  inAllerta: boolean;
  lastOpAt: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function computePlafondSaldi(orgId: string): Promise<PlafondSaldo[]> {
  const [ops, registry, resolveRs, consumoRaw] = await Promise.all([
    storage.listPlafondRicaricheOps(orgId),
    cdgStorage.listRagioniSociali(orgId, { includeAuto: true }),
    cdgStorage.getRsResolver(orgId),
    storage.getRicaricheConsumoByRawRs(orgId),
  ]);
  const nameById = new Map(registry.map((r) => [r.id, r.nome]));
  // Consumo totale per RS canonica (somma delle varianti di nome grezze).
  const consumoTotByCanon = new Map<string, number>();
  for (const row of consumoRaw) {
    const canon = resolveRs(row.rs) || "N/D";
    consumoTotByCanon.set(canon, (consumoTotByCanon.get(canon) ?? 0) + row.consumo);
  }
  // Raggruppa le operazioni per RS (già ordinate per createdAt asc).
  const opsByRs = new Map<string, typeof ops>();
  for (const op of ops) {
    if (!opsByRs.has(op.ragioneSocialeId)) opsByRs.set(op.ragioneSocialeId, []);
    opsByRs.get(op.ragioneSocialeId)!.push(op);
  }
  const out: PlafondSaldo[] = [];
  const seenCanon = new Set<string>();
  for (const [rsId, rsOps] of opsByRs) {
    const nome = nameById.get(rsId) ?? "N/D";
    const canon = resolveRs(nome) || nome;
    seenCanon.add(canon);
    // Base = ultima 'imposta' (saldo assoluto + cutoff); poi somma le
    // 'aggiungi' successive e sottrae il consumo dopo il cutoff.
    let base = 0;
    let cutoff: Date | null = null;
    let baseIdx = -1;
    for (let i = rsOps.length - 1; i >= 0; i--) {
      if (rsOps[i].tipo === "imposta") {
        base = Number(rsOps[i].saldoDopo);
        cutoff = rsOps[i].consumoCutoff ? new Date(rsOps[i].consumoCutoff as any) : null;
        baseIdx = i;
        break;
      }
    }
    let aggiunte = 0;
    for (let i = baseIdx + 1; i < rsOps.length; i++) {
      if (rsOps[i].tipo === "aggiungi") aggiunte += Number(rsOps[i].importo);
    }
    // Soglia di avviso (Task #538): vince l'ULTIMA op 'soglia' registrata;
    // importo 0 = soglia disattivata (resta solo l'allerta per negativo).
    let sogliaConf: number | null = null;
    let sogliaCustom = false;
    for (let i = rsOps.length - 1; i >= 0; i--) {
      if (rsOps[i].tipo === "soglia") {
        const v = Number(rsOps[i].importo);
        sogliaConf = v > 0 ? v : null;
        sogliaCustom = true;
        break;
      }
    }
    // Le op 'soglia' non configurano il plafond: il saldo esiste solo se c'è
    // almeno un'op 'imposta' o 'aggiungi'.
    const hasSaldoOps = rsOps.some((o) => o.tipo === "imposta" || o.tipo === "aggiungi");
    const consumoTotale = consumoTotByCanon.get(canon) ?? 0;
    let consumoDaCutoff = consumoTotale;
    if (cutoff) {
      const after = await storage.getRicaricheConsumoByRawRs(orgId, cutoff);
      consumoDaCutoff = after
        .filter((r) => (resolveRs(r.rs) || "N/D") === canon)
        .reduce((s, r) => s + r.consumo, 0);
    }
    const saldo = hasSaldoOps ? round2(base + aggiunte - consumoDaCutoff) : null;
    const soglia = saldo === null
      ? sogliaCustom ? sogliaConf : null
      : (sogliaCustom ? sogliaConf : PLAFOND_SOGLIA_DEFAULT);
    out.push({
      ragioneSocialeId: rsId,
      ragioneSociale: canon,
      saldo,
      consumoTotale: round2(consumoTotale),
      consumoDaCutoff: round2(consumoDaCutoff),
      soglia,
      sogliaCustom,
      inAllerta: saldo !== null && (saldo < 0 || (soglia !== null && saldo < soglia)),
      lastOpAt: rsOps[rsOps.length - 1].createdAt?.toISOString?.() ?? null,
    });
  }
  // RS con consumo ricariche ma senza plafond configurato: visibili con
  // saldo null, così la pagina può mostrare "plafond non configurato".
  for (const [canon, consumo] of consumoTotByCanon) {
    if (seenCanon.has(canon) || consumo <= 0) continue;
    seenCanon.add(canon);
    out.push({
      ragioneSocialeId: "",
      ragioneSociale: canon,
      saldo: null,
      consumoTotale: round2(consumo),
      consumoDaCutoff: round2(consumo),
      soglia: null,
      sogliaCustom: false,
      inAllerta: false,
      lastOpAt: null,
    });
  }
  // Ogni RS del registro compare comunque (anche senza vendite RICARICHE e
  // senza operazioni): consente all'admin di impostare il plafond in via
  // preventiva su una RS appena creata, prima che venda la prima ricarica.
  for (const r of registry) {
    const canon = resolveRs(r.nome) || r.nome;
    if (seenCanon.has(canon)) continue;
    seenCanon.add(canon);
    out.push({
      ragioneSocialeId: r.id,
      ragioneSociale: canon,
      saldo: null,
      consumoTotale: 0,
      consumoDaCutoff: 0,
      soglia: null,
      sogliaCustom: false,
      inAllerta: false,
      lastOpAt: null,
    });
  }
  return out.sort((a, b) => a.ragioneSociale.localeCompare(b.ragioneSociale, "it"));
}
