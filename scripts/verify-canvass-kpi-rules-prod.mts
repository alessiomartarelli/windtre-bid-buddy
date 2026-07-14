// Verifica end-to-end delle regole KPI canvass su una vera org VF in prod.
// Replica esattamente il percorso di Vendite BiSuite: listino canvass baked
// (buildCanvassIndex) + regole KPI da organization_config → classifyArticle.
// Regole attese nel config prod (org Phone&Phone):
//   1) categoria GARANTEASY → assicurazioni (articolo altrimenti NON canvass)
//   2) categoria ALLARME → escludi (articolo altrimenti canvass/protecta)
// Uso: DATABASE_URL=<prod via tunnel> npx tsx scripts/verify-canvass-kpi-rules-prod.mts
import pg from 'pg';
import { CANVASS_CATALOG } from '../shared/canvassCatalog';
import { buildCanvassIndex } from '../shared/canvassMapping';
import { classifyArticle } from '../shared/bisuiteClassification';
import { sanitizeCanvassKpiRules } from '../shared/canvassKpiRules';

const ORG = '39e07448-d6b5-488e-a796-51b9e6f4fc0d'; // Phone&Phone (VF)

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const cfgRes = await client.query(
  `SELECT config->'canvassKpiRules' AS rules FROM organization_config WHERE organization_id=$1`,
  [ORG],
);
const kpiRules = sanitizeCanvassKpiRules(cfgRes.rows[0]?.rules);
console.log('Regole KPI sanificate dal config prod:', JSON.stringify(kpiRules));

const index = buildCanvassIndex(CANVASS_CATALOG.offers);

const salesRes = await client.query(
  `SELECT id, raw_data FROM bisuite_sales
   WHERE organization_id=$1 AND data_vendita >= '2026-06-01'`,
  [ORG],
);
console.log(`Vendite caricate (>= 2026-06-01): ${salesRes.rows.length}`);

function tally(rules: ReturnType<typeof sanitizeCanvassKpiRules> | null) {
  const counts: Record<string, number> = {};
  let garanteasy: any = null;
  let allarme: any = null;
  for (const row of salesRes.rows) {
    const arts: any[] = row.raw_data?.articoli || [];
    for (const art of arts) {
      const cls = classifyArticle(art, index, rules);
      if (cls?.type === 'canvass' && cls.pista) {
        counts[cls.pista] = (counts[cls.pista] || 0) + 1;
      }
      const cat = art.categoria?.nome || '';
      if (cat === 'GARANTEASY' && !garanteasy) garanteasy = { codice: art.codice, cls };
      if (cat === 'ALLARME' && !allarme) allarme = { codice: art.codice, cls };
    }
  }
  return { counts, garanteasy, allarme };
}

const before = tally(null);
const after = tally(kpiRules);
console.log('\n--- KPI piste SENZA regole:', JSON.stringify(before.counts));
console.log('    GARANTEASY:', JSON.stringify(before.garanteasy), '| ALLARME:', JSON.stringify(before.allarme));
console.log('\n--- KPI piste CON regole:  ', JSON.stringify(after.counts));
console.log('    GARANTEASY:', JSON.stringify(after.garanteasy), '| ALLARME:', JSON.stringify(after.allarme));

const deltaAssic = (after.counts['assicurazioni'] || 0) - (before.counts['assicurazioni'] || 0);
const deltaProtecta = (after.counts['protecta'] || 0) - (before.counts['protecta'] || 0);
console.log(`\nDelta assicurazioni: +${deltaAssic} | Delta protecta: ${deltaProtecta}`);

if (kpiRules.length !== 2) throw new Error('FAIL: attese 2 regole nel config prod');
if (deltaAssic <= 0) throw new Error('FAIL: la regola GARANTEASY→assicurazioni non ha effetto');
if (after.garanteasy?.cls?.type !== 'canvass' || after.garanteasy?.cls?.pista !== 'assicurazioni') {
  throw new Error('FAIL: GARANTEASY non classificato canvass/assicurazioni con le regole');
}
if (before.allarme?.cls?.pista !== 'protecta') {
  throw new Error('FAIL: baseline attesa ALLARME→protecta senza regole');
}
// 'escludi' mantiene il type ma toglie la pista: l'articolo non conta in
// nessuna pista KPI (countByPista tallia solo articoli con pista).
if (after.allarme?.cls?.pista) {
  throw new Error('FAIL: ALLARME dovrebbe essere ESCLUSO dalle piste KPI con le regole');
}
if (deltaProtecta >= 0) throw new Error('FAIL: esclusione ALLARME non riduce protecta');
console.log('\nOK: le regole KPI (mapping + esclusione) cambiano i conteggi sui dati reali di prod.');
await client.end();
