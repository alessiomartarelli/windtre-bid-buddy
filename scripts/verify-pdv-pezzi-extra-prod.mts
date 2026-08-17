/**
 * Verifica (Task #399): confronto colonne extra Tabella PDV × Pista su dati
 * reali di produzione.
 *
 * Confronta i totali (IVA, CB, Telefoni, € Accessori, € Servizi) calcolati
 * dai DUE percorsi distinti:
 *
 *   A) Percorso SERVER (Dashboard Gara):
 *      aggregateMappedSales → pdv.pezziIva / cbCambiPiano / telefoni /
 *      accessori.importo / servizi.importo
 *      (logica in server/bisuiteMappedSales.ts)
 *
 *   B) Percorso CLIENT (Vendite BiSuite):
 *      classifySaleArticles → accumulaPezziExtra
 *      (logica in shared/bisuiteClassification.ts + shared/pdvPezziExtra.ts)
 *
 * Le due funzioni sono state estratte dalla UI per essere eseguite in-process
 * qui, sugli stessi dati grezzi letti dal DB di prod.
 *
 * Lancio (DATABASE_URL puntato al DB di prod via tunnel SSH):
 *   DATABASE_URL=<url> npx tsx scripts/verify-pdv-pezzi-extra-prod.mts
 *
 * Opzioni:
 *   MESE=7 ANNO=2026  — mese/anno da verificare (default: mese precedente)
 *   ORG_ID=<uuid>     — limita la verifica a una sola org
 */
import pg from 'pg';
import { aggregateMappedSales } from '../server/bisuiteMappedSales.js';
import { classifySaleArticles } from '../shared/bisuiteClassification.js';
import {
  accumulaPezziExtra,
  emptyPezziExtra,
  nettoIva,
  type PezziExtraCounters,
} from '../shared/pdvPezziExtra.js';

// ── Parametri ────────────────────────────────────────────────────────────────
const now = new Date();
const defaultMese = now.getMonth() === 0 ? 12 : now.getMonth(); // mese precedente
const defaultAnno = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

const MESE = parseInt(process.env.MESE || String(defaultMese), 10);
const ANNO = parseInt(process.env.ANNO || String(defaultAnno), 10);
const ONLY_ORG = (process.env.ORG_ID || '').trim();

const meseStr = String(MESE).padStart(2, '0');
const fromDate = `${ANNO}-${meseStr}-01`;
const toDate = new Date(ANNO, MESE, 0); // ultimo giorno del mese
const toDateStr = `${ANNO}-${meseStr}-${String(toDate.getDate()).padStart(2, '0')}`;

console.log(`\n[verifica] Periodo: ${fromDate} → ${toDateStr}`);
if (ONLY_ORG) console.log(`[verifica] Filtro org: ${ONLY_ORG}`);

// ── DB connection ─────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// ── Caricamento vendite ───────────────────────────────────────────────────────
const orgFilter = ONLY_ORG ? `AND organization_id = $3` : '';
const params: (string | Date)[] = [fromDate, toDateStr];
if (ONLY_ORG) params.push(ONLY_ORG);

// Esclude ANNULLATE come fanno entrambe le pagine (il filtro server-side di
// default le esclude; la UI filtra ulteriormente s.stato !== 'ANNULLATA').
const salesRes = await client.query(
  `SELECT organization_id, codice_pos, nome_negozio, ragione_sociale, raw_data
   FROM bisuite_sales
   WHERE data_vendita::date BETWEEN $1::date AND $2::date
     AND (UPPER(TRIM(stato)) != 'ANNULLATA' OR stato IS NULL)
     ${orgFilter}
   ORDER BY organization_id, codice_pos`,
  params,
);
await client.end();

console.log(`[verifica] Vendite caricate (non ANNULLATE): ${salesRes.rows.length}`);
if (salesRes.rows.length === 0) {
  console.log('[verifica] Nessuna vendita trovata — interrotto.');
  process.exit(0);
}

// ── Struttura per org: raggruppa le vendite ────────────────────────────────
type RawSale = { organization_id: string; codice_pos: string | null; nome_negozio: string | null; ragione_sociale: string | null; raw_data: any };
const byOrg = new Map<string, RawSale[]>();
for (const row of salesRes.rows as RawSale[]) {
  if (!byOrg.has(row.organization_id)) byOrg.set(row.organization_id, []);
  byOrg.get(row.organization_id)!.push(row);
}

// ── Contatori globali ─────────────────────────────────────────────────────────
type ColKey = 'iva' | 'cb' | 'telefoni' | 'accEuro' | 'srvEuro';
type SideTotals = Record<ColKey, number>;
const emptyTotals = (): SideTotals => ({ iva: 0, cb: 0, telefoni: 0, accEuro: 0, srvEuro: 0 });

const grandServer = emptyTotals();
const grandClient = emptyTotals();

// Divergenze rilevate (per PDV)
const divergences: Array<{ orgId: string; pdv: string; col: ColKey; server: number; client: number; delta: number }> = [];

let orgsProcessed = 0;
let pdvsTotal = 0;

// ── Per ciascuna org: confronto ───────────────────────────────────────────────
for (const [orgId, rows] of byOrg) {
  orgsProcessed++;

  // Converti in MappableSale (forma accettata da aggregateMappedSales).
  const mappableSales = rows.map(r => ({
    dataVendita: null,
    rawData: r.raw_data,
    codicePos: r.codice_pos,
    nomeNegozio: r.nome_negozio,
    ragioneSociale: r.ragione_sociale,
  }));

  // ── Percorso A: SERVER ─────────────────────────────────────────────────────
  // Passiamo rules=[] perché IVA/CB/Telefoni/Accessori/Servizi non dipendono
  // dalle regole di mapping (dipendono solo dalla categoria BiSuite).
  const agg = aggregateMappedSales(mappableSales, []);

  // ── Percorso B: CLIENT ─────────────────────────────────────────────────────
  // classifySaleArticles + accumulaPezziExtra, senza canvassIndex né kpiRules
  // (org WindTre standard — stessa baseline del server).
  const clientByPdv = new Map<string, PezziExtraCounters>();
  for (const row of rows) {
    const pos = row.codice_pos || 'UNKNOWN';
    if (!clientByPdv.has(pos)) clientByPdv.set(pos, emptyPezziExtra());
    const sc = classifySaleArticles(row.raw_data, null, null);
    for (const art of sc.articles) {
      accumulaPezziExtra(clientByPdv.get(pos)!, art);
    }
  }

  // ── Confronto per PDV ──────────────────────────────────────────────────────
  const allPdvs = new Set([
    ...Object.keys(agg.byPdv),
    ...clientByPdv.keys(),
  ]);

  for (const pos of allPdvs) {
    pdvsTotal++;
    const srv = agg.byPdv[pos];
    const cli = clientByPdv.get(pos);

    // Valori server
    const srvIva = srv?.pezziIva ?? 0;
    const srvCb = srv?.cbCambiPiano ?? 0;
    const srvTel = srv?.telefoni ?? 0;
    const srvAcc = nettoIva(srv?.accessori?.importo ?? 0);
    const srvSrv = nettoIva(srv?.servizi?.importo ?? 0);

    // Valori client
    const cliIva = cli?.iva ?? 0;
    const cliCb = cli?.cb ?? 0;
    const cliTel = cli?.telefoni ?? 0;
    const cliAcc = cli?.accEuro ?? 0;
    const cliSrv = cli?.srvEuro ?? 0;

    // Accumula grand totals
    grandServer.iva += srvIva; grandServer.cb += srvCb; grandServer.telefoni += srvTel;
    grandServer.accEuro += srvAcc; grandServer.srvEuro += srvSrv;
    grandClient.iva += cliIva; grandClient.cb += cliCb; grandClient.telefoni += cliTel;
    grandClient.accEuro += cliAcc; grandClient.srvEuro += cliSrv;

    // Soglia: per i contatori interi tolleriamo 0; per gli euro 0.01
    const checks: Array<[ColKey, number, number]> = [
      ['iva', srvIva, cliIva],
      ['cb', srvCb, cliCb],
      ['telefoni', srvTel, cliTel],
      ['accEuro', srvAcc, cliAcc],
      ['srvEuro', srvSrv, cliSrv],
    ];
    for (const [col, sv, cv] of checks) {
      const delta = Math.abs(sv - cv);
      const threshold = (col === 'accEuro' || col === 'srvEuro') ? 0.001 : 0;
      if (delta > threshold) {
        divergences.push({ orgId, pdv: pos, col, server: sv, client: cv, delta });
      }
    }
  }
}

// ── Riepilogo ─────────────────────────────────────────────────────────────────
const fmt = (n: number, euro?: boolean) =>
  euro ? `€${n.toFixed(2)}` : String(n);

console.log(`\n[verifica] Organizzazioni elaborate: ${orgsProcessed} | PDV totali: ${pdvsTotal}`);
console.log('\n══ GRAND TOTAL ═══════════════════════════════════════════════════');
console.log(`  Colonna         │ SERVER (Dashboard Gara)  │ CLIENT (Vendite BiSuite)`);
console.log(`  IVA             │ ${grandServer.iva.toString().padStart(24)} │ ${grandClient.iva}`);
console.log(`  CB              │ ${grandServer.cb.toString().padStart(24)} │ ${grandClient.cb}`);
console.log(`  Telefoni        │ ${grandServer.telefoni.toString().padStart(24)} │ ${grandClient.telefoni}`);
console.log(`  € Accessori     │ ${fmt(grandServer.accEuro, true).padStart(24)} │ ${fmt(grandClient.accEuro, true)}`);
console.log(`  € Servizi       │ ${fmt(grandServer.srvEuro, true).padStart(24)} │ ${fmt(grandClient.srvEuro, true)}`);
console.log('══════════════════════════════════════════════════════════════════');

if (divergences.length === 0) {
  console.log('\n✅ NESSUNA DIVERGENZA — i due percorsi producono gli stessi numeri su tutti i PDV.');
} else {
  console.log(`\n⚠️  DIVERGENZE rilevate: ${divergences.length} (${new Set(divergences.map(d => d.pdv)).size} PDV distinti)\n`);

  // Raggruppa per colonna
  const byCol = new Map<ColKey, typeof divergences>();
  for (const d of divergences) {
    if (!byCol.has(d.col)) byCol.set(d.col, []);
    byCol.get(d.col)!.push(d);
  }

  for (const [col, divs] of byCol) {
    const isEuro = col === 'accEuro' || col === 'srvEuro';
    console.log(`\n  Colonna: ${col} — ${divs.length} PDV divergenti`);
    for (const d of divs.sort((a, b) => b.delta - a.delta).slice(0, 20)) {
      console.log(
        `    org=${d.orgId.slice(0, 8)}… pdv=${d.pdv.padEnd(12)} ` +
        `server=${fmt(d.server, isEuro).padStart(10)} client=${fmt(d.client, isEuro).padStart(10)} ` +
        `Δ=${fmt(d.delta, isEuro)}`,
      );
    }
    if (divs.length > 20) console.log(`    ... e altri ${divs.length - 20} PDV`);
  }

  // Diagnosi automatica dei pattern di divergenza
  console.log('\n──── DIAGNOSI ────────────────────────────────────────────────────');
  const colTotals: Record<ColKey, { srvSum: number; cliSum: number }> = {
    iva: { srvSum: 0, cliSum: 0 }, cb: { srvSum: 0, cliSum: 0 },
    telefoni: { srvSum: 0, cliSum: 0 }, accEuro: { srvSum: 0, cliSum: 0 },
    srvEuro: { srvSum: 0, cliSum: 0 },
  };
  for (const d of divergences) {
    colTotals[d.col].srvSum += d.server;
    colTotals[d.col].cliSum += d.client;
  }
  for (const [col, { srvSum, cliSum }] of Object.entries(colTotals) as [ColKey, { srvSum: number; cliSum: number }][]) {
    const tot = divergences.filter(d => d.col === col);
    if (tot.length === 0) continue;
    const isEuro = col === 'accEuro' || col === 'srvEuro';
    console.log(`  ${col}: Σ(server)=${fmt(srvSum, isEuro)} Σ(client)=${fmt(cliSum, isEuro)} → server ${srvSum > cliSum ? 'MAGGIORE' : 'MINORE'}`);
  }
}

process.exit(divergences.length > 0 ? 1 : 0);
