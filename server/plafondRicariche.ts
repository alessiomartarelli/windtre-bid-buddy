// Task #537/#538/#544 — Plafond ricariche.
//
// Calcolo condiviso dei saldi plafond (routes + report Telegram). Il saldo è
// sempre DERIVATO dalle operazioni admin append-only + il consumo RICARICHE
// (vendite non annullate), mai un contatore decrementato.
//
// Task #544 — la chiave contabile del plafond è il CODICE DEALER ("8 miliardi")
// configurato sui PDV della Struttura (organization_config.puntiVendita):
//   - più codici POS possono condividere lo stesso dealer ⇒ stesso plafond;
//   - la stessa Ragione Sociale può contenere dealer diversi ⇒ saldi separati;
//   - un PDV senza dealer viene SEGNALATO (riga per RS flag senzaDealer), mai
//     attribuito silenziosamente alla RS di un dealer;
//   - operazioni storiche per RS (codice_dealer NULL) sono attribuite in
//     lettura al dealer quando la RS mappa su UN solo dealer; con più dealer
//     restano su una riga RS "da assegnare" finché l'admin non le assegna
//     esplicitamente (nessuna duplicazione: l'assegnazione ripunta le stesse
//     operazioni, non ne crea di nuove).
// Le org che non hanno ancora configurato alcun dealer mantengono il
// comportamento storico per Ragione Sociale.
import { storage } from "./storage";
import { cdgStorage } from "./cdgStorage";

// Soglia di avviso di default (in €) quando l'admin non ne ha configurata
// una: il plafond è configurato ma la soglia no ⇒ avvisa comunque quando il
// saldo scende sotto questo valore (oltre che quando è negativo).
export const PLAFOND_SOGLIA_DEFAULT = 50;

export type PlafondPdvRef = { codicePos: string; nome: string };

export type PlafondSaldo = {
  // Chiave contabile (Task #544). "" per le righe legacy per RS (org senza
  // dealer configurati, oppure operazioni storiche non ancora assegnate).
  codiceDealer: string;
  // Descrittiva: RS dei PDV del dealer (unione, separate da " / ") oppure la
  // RS canonica per le righe legacy.
  ragioneSociale: string;
  // Anchor RS canonica per le righe legacy per RS ("" per le righe dealer).
  ragioneSocialeId: string;
  // PDV della Struttura che consumano questo plafond.
  pdv: PlafondPdvRef[];
  // true: operazioni storiche per RS in un'org con dealer configurati, da
  // assegnare esplicitamente a un dealer (RS con più dealer o RS non mappata).
  daAssegnare: boolean;
  // true: consumo da PDV SENZA codice dealer in un'org che ha dealer
  // configurati — va segnalato, non attribuito a un dealer.
  senzaDealer: boolean;
  saldo: number | null;          // null = plafond mai configurato
  consumoTotale: number;         // consumo ricariche complessivo (info)
  consumoDaCutoff: number;       // consumo conteggiato nel saldo corrente
  soglia: number | null;
  sogliaCustom: boolean;
  inAllerta: boolean;
  lastOpAt: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const normKey = (s: unknown) => String(s ?? "").trim().toUpperCase();

// Gli import storici possono usare il segnaposto "vuoto" per indicare il POS
// mancante che BiSuite restituisce come stringa vuota. La RS entra nella
// chiave per evitare collisioni tra più PDV senza POS appartenenti a RS diverse.
const posMappingKey = (pos: unknown, rsCanon: string) => {
  const normalized = normKey(pos);
  return !normalized || normalized === "VUOTO"
    ? `@EMPTY:${normKey(rsCanon)}`
    : `@POS:${normalized}`;
};

type StructPdvCfg = {
  codicePos?: string; nome?: string; ragioneSociale?: string; codiceDealer?: string;
};

export type DealerInfo = {
  codice: string;                 // codice dealer come configurato (trim)
  pdv: PlafondPdvRef[];
  rsCanon: Set<string>;           // RS canoniche dei suoi PDV
  posKeys: Set<string>;           // chiavi POS interne (namespace reale/vuoto)
};

// Mappa POS→dealer e registro dealer dalla Struttura PDV dell'org.
export async function getDealerMaps(orgId: string, resolveRs: (rs: string) => string | null): Promise<{
  posToDealer: Map<string, string>;      // posKey → dealerKey
  dealers: Map<string, DealerInfo>;      // dealerKey → info
  posSenzaDealer: Map<string, { rsCanon: string; pdv: PlafondPdvRef }>; // posKey → RS canonica
  rsConPdv: Set<string>;                 // RS canoniche con ≥1 PDV in Struttura (Task #548)
}> {
  const cfg = await storage.getOrgConfig(orgId);
  const pv = (((cfg?.config as Record<string, unknown> | null)?.puntiVendita || []) as StructPdvCfg[]);
  const posToDealer = new Map<string, string>();
  const dealers = new Map<string, DealerInfo>();
  const posSenzaDealer = new Map<string, { rsCanon: string; pdv: PlafondPdvRef }>();
  const rsConPdv = new Set<string>();
  if (!Array.isArray(pv)) return { posToDealer, dealers, posSenzaDealer, rsConPdv };
  for (const p of pv) {
    const codicePos = String(p?.codicePos ?? "").trim();
    const rsNamePre = String(p?.ragioneSociale ?? "").trim();
    // Perimetro RS visibili (Task #548): ogni riga PDV della Struttura con una
    // RS conta, anche se (ancora) senza codice POS.
    if (rsNamePre) rsConPdv.add(resolveRs(rsNamePre) || rsNamePre);
    // Il POS vuoto è una chiave configurabile intenzionale: BiSuite può
    // restituire vendite prive di codice POS e l'admin può censire una riga
    // con codice vuoto per attribuirle esplicitamente a un dealer.
    const nome = String(p?.nome ?? "").trim();
    const rsName = rsNamePre;
    const rsCanon = rsName ? (resolveRs(rsName) || rsName) : "N/D";
    const posKey = posMappingKey(codicePos, rsCanon);
    const dealer = String(p?.codiceDealer ?? "").trim();
    if (!dealer) {
      posSenzaDealer.set(posKey, { rsCanon, pdv: { codicePos, nome } });
      continue;
    }
    const dealerKey = normKey(dealer);
    posToDealer.set(posKey, dealerKey);
    let d = dealers.get(dealerKey);
    if (!d) { d = { codice: dealer, pdv: [], rsCanon: new Set(), posKeys: new Set() }; dealers.set(dealerKey, d); }
    d.pdv.push({ codicePos, nome });
    d.rsCanon.add(rsCanon);
    d.posKeys.add(posKey);
  }
  return { posToDealer, dealers, posSenzaDealer, rsConPdv };
}

type Bucket = {
  key: string;
  codiceDealer: string;
  ragioneSocialeId: string;
  label: string;                 // RS descrittiva
  pdv: PlafondPdvRef[];
  posKeys: Set<string>;          // POS del bucket (per il consumo dal cutoff)
  rsCanon: string | null;        // per le righe RS legacy (match consumo)
  daAssegnare: boolean;
  senzaDealer: boolean;
  ops: Awaited<ReturnType<typeof storage.listPlafondRicaricheOps>>;
  consumoTotale: number;
};

export async function computePlafondSaldi(orgId: string): Promise<PlafondSaldo[]> {
  const resolveRs = await cdgStorage.getRsResolver(orgId);
  const [ops, registry, consumoRaw, maps] = await Promise.all([
    storage.listPlafondRicaricheOps(orgId),
    cdgStorage.listRagioniSociali(orgId, { includeAuto: true }),
    storage.getRicaricheConsumoByPos(orgId),
    getDealerMaps(orgId, resolveRs),
  ]);
  const { posToDealer, dealers, posSenzaDealer, rsConPdv } = maps;
  const hasDealers = dealers.size > 0;
  const nameById = new Map(registry.map((r) => [r.id, r.nome]));
  const idByCanon = new Map<string, string>();
  for (const r of registry) {
    const canon = resolveRs(r.nome) || r.nome;
    if (!idByCanon.has(canon)) idByCanon.set(canon, r.id);
  }

  const buckets = new Map<string, Bucket>();
  const dealerBucket = (dealerKey: string): Bucket => {
    const k = `dealer:${dealerKey}`;
    let b = buckets.get(k);
    if (!b) {
      const info = dealers.get(dealerKey);
      const rsNames = info ? Array.from(info.rsCanon).sort((a, z) => a.localeCompare(z, "it")) : [];
      b = {
        key: k,
        codiceDealer: info?.codice ?? dealerKey,
        ragioneSocialeId: "",
        label: rsNames.join(" / ") || "N/D",
        pdv: info?.pdv ?? [],
        posKeys: new Set(info?.posKeys ?? []),
        rsCanon: null,
        daAssegnare: false,
        senzaDealer: false,
        ops: [],
        consumoTotale: 0,
      };
      buckets.set(k, b);
    }
    return b;
  };
  const rsBucket = (canon: string): Bucket => {
    const k = `rs:${canon}`;
    let b = buckets.get(k);
    if (!b) {
      b = {
        key: k,
        codiceDealer: "",
        ragioneSocialeId: idByCanon.get(canon) ?? "",
        label: canon,
        pdv: [],
        posKeys: new Set(),
        rsCanon: canon,
        daAssegnare: false,
        senzaDealer: false,
        ops: [],
        consumoTotale: 0,
      };
      buckets.set(k, b);
    }
    return b;
  };

  // --- Consumo per POS: dealer se mappato, altrimenti riga RS (segnalata) ---
  for (const row of consumoRaw) {
    const fallbackCanon = resolveRs(row.rs) || row.rs || "N/D";
    const posKey = posMappingKey(row.pos, fallbackCanon);
    const dealerKey = posToDealer.get(posKey);
    if (dealerKey) {
      dealerBucket(dealerKey).consumoTotale += row.consumo;
    } else {
      const canon = posSenzaDealer.get(posKey)?.rsCanon ?? fallbackCanon;
      const b = rsBucket(canon);
      b.consumoTotale += row.consumo;
      b.posKeys.add(posKey);
      if (hasDealers) b.senzaDealer = true;
      const ref = posSenzaDealer.get(posKey)?.pdv;
      if (ref && !b.pdv.some((p) => normKey(p.codicePos) === posKey)) b.pdv.push(ref);
    }
  }
  // Anche i PDV senza dealer SENZA consumo vanno segnalati (org con dealer).
  if (hasDealers) {
    for (const [posKey, info] of posSenzaDealer) {
      const b = rsBucket(info.rsCanon);
      b.senzaDealer = true;
      b.posKeys.add(posKey);
      if (!b.pdv.some((p) => normKey(p.codicePos) === posKey)) b.pdv.push(info.pdv);
    }
  }

  // --- Operazioni: per dealer, oppure legacy per RS (attribuzione in lettura) ---
  for (const op of ops) {
    const opDealer = String((op as { codiceDealer?: string | null }).codiceDealer ?? "").trim();
    if (opDealer) {
      dealerBucket(normKey(opDealer)).ops.push(op);
      continue;
    }
    const rsName = op.ragioneSocialeId ? (nameById.get(op.ragioneSocialeId) ?? "N/D") : "N/D";
    const canon = resolveRs(rsName) || rsName;
    // Dealer candidati: quelli i cui PDV appartengono a questa RS canonica.
    const matches: string[] = [];
    for (const [dk, info] of dealers) if (info.rsCanon.has(canon)) matches.push(dk);
    if (matches.length === 1) {
      dealerBucket(matches[0]).ops.push(op);
    } else {
      const b = rsBucket(canon);
      if (op.ragioneSocialeId) b.ragioneSocialeId = op.ragioneSocialeId;
      b.ops.push(op);
      // In un'org con dealer configurati le op legacy vanno assegnate
      // esplicitamente (RS con più dealer, o RS non presente in Struttura).
      if (hasDealers) b.daAssegnare = true;
    }
  }

  // --- Dealer configurati senza op/consumo: compaiono comunque (preventivo) ---
  for (const dk of dealers.keys()) dealerBucket(dk);

  // --- Org SENZA dealer: compaiono le RS con almeno un PDV in Struttura ---
  // (Task #548: le anagrafiche del registro SENZA PDV non materializzano più
  // una card "Plafond non configurato"; il registro serve solo per l'anchor.)
  if (!hasDealers) {
    for (const canon of rsConPdv) rsBucket(canon);
    for (const r of registry) {
      const canon = resolveRs(r.nome) || r.nome;
      if (!rsConPdv.has(canon)) continue;
      const b = rsBucket(canon);
      if (!b.ragioneSocialeId) b.ragioneSocialeId = r.id;
    }
  }

  const out: PlafondSaldo[] = [];
  for (const b of buckets.values()) {
    // Task #548 — una riga legacy per RS compare solo se la RS ha almeno un
    // PDV in Struttura oppure consumo reale (vendite su POS non in Struttura:
    // dati contabili da non nascondere). Le sole operazioni storiche NON
    // fanno ricomparire la card: restano consultabili nello storico.
    if (b.rsCanon !== null && !rsConPdv.has(b.rsCanon) && b.consumoTotale === 0) continue;
    const bOps = b.ops;
    let base = 0;
    let cutoff: Date | null = null;
    let baseIdx = -1;
    // Le operazioni nuove di saldo ('imposta' e 'aggiungi') contengono una
    // fotografia saldoDopo + cutoff. L'ultima modifica diventa quindi la base
    // e assorbe tutte le vendite precedenti. Le vecchie operazioni 'aggiungi'
    // senza cutoff restano compatibili col calcolo storico sotto.
    for (let i = bOps.length - 1; i >= 0; i--) {
      const op = bOps[i];
      if ((op.tipo === "imposta" || op.tipo === "aggiungi") && op.consumoCutoff) {
        base = Number(op.saldoDopo);
        cutoff = new Date(op.consumoCutoff as any);
        baseIdx = i;
        break;
      }
    }
    // Compatibilità con il ledger precedente: se nessuna op dispone della
    // fotografia, l'ultima 'imposta' resta la base e le aggiunte successive
    // vengono sommate come prima.
    if (baseIdx < 0) {
      for (let i = bOps.length - 1; i >= 0; i--) {
        if (bOps[i].tipo === "imposta") {
          base = Number(bOps[i].saldoDopo);
          cutoff = bOps[i].consumoCutoff ? new Date(bOps[i].consumoCutoff as any) : null;
          baseIdx = i;
          break;
        }
      }
    }
    let aggiunte = 0;
    for (let i = baseIdx + 1; i < bOps.length; i++) {
      if (bOps[i].tipo === "aggiungi") aggiunte += Number(bOps[i].importo);
    }
    // Soglia di avviso (Task #538): vince l'ULTIMA op 'soglia' registrata;
    // importo 0 = soglia disattivata (resta solo l'allerta per negativo).
    let sogliaConf: number | null = null;
    let sogliaCustom = false;
    for (let i = bOps.length - 1; i >= 0; i--) {
      if (bOps[i].tipo === "soglia") {
        const v = Number(bOps[i].importo);
        sogliaConf = v > 0 ? v : null;
        sogliaCustom = true;
        break;
      }
    }
    const hasSaldoOps = bOps.some((o) => o.tipo === "imposta" || o.tipo === "aggiungi");
    const consumoTotale = b.consumoTotale;
    let consumoDaCutoff = consumoTotale;
    if (cutoff) {
      const after = await storage.getRicaricheConsumoByPos(orgId, cutoff);
      consumoDaCutoff = after
        .filter((r) => {
          const fallbackCanon = resolveRs(r.rs) || r.rs || "N/D";
          const posKey = posMappingKey(r.pos, fallbackCanon);
          if (b.rsCanon === null) return b.posKeys.has(posKey) || posToDealer.get(posKey) === normKey(b.codiceDealer);
          // Riga RS legacy: solo POS non mappati a un dealer, stessa RS canonica.
          if (posToDealer.has(posKey)) return false;
          const canon = posSenzaDealer.get(posKey)?.rsCanon ?? fallbackCanon;
          return canon === b.rsCanon;
        })
        .reduce((s, r) => s + r.consumo, 0);
    }
    const saldo = hasSaldoOps ? round2(base + aggiunte - consumoDaCutoff) : null;
    const soglia = saldo === null
      ? sogliaCustom ? sogliaConf : null
      : (sogliaCustom ? sogliaConf : PLAFOND_SOGLIA_DEFAULT);
    out.push({
      codiceDealer: b.codiceDealer,
      ragioneSociale: b.label,
      ragioneSocialeId: b.ragioneSocialeId,
      pdv: b.pdv,
      daAssegnare: b.daAssegnare,
      senzaDealer: b.senzaDealer,
      saldo,
      consumoTotale: round2(consumoTotale),
      consumoDaCutoff: round2(consumoDaCutoff),
      soglia,
      sogliaCustom,
      inAllerta: saldo !== null && (saldo < 0 || (soglia !== null && saldo < soglia)),
      lastOpAt: bOps.length > 0 ? (bOps[bOps.length - 1].createdAt?.toISOString?.() ?? null) : null,
    });
  }
  return out.sort((a, z) =>
    a.ragioneSociale.localeCompare(z.ragioneSociale, "it") ||
    a.codiceDealer.localeCompare(z.codiceDealer, "it"));
}
