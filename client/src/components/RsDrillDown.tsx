import { useMemo, useState } from 'react';
import { Preventivo } from '@/hooks/usePreventivi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  Smartphone,
  Wifi,
  Users,
  Zap,
  Shield,
  Award,
  Building2,
  ChevronDown,
} from 'lucide-react';
import { MOBILE_CATEGORY_LABELS } from '@/types/preventivatore';

/* ── colour palette ─────────────────────────────────────────── */
const CATEGORY_COLORS: Record<string, string> = {
  Mobile: 'hsl(20, 100%, 50%)',
  Fisso: 'hsl(280, 85%, 50%)',
  Partnership: 'hsl(200, 80%, 50%)',
  Energia: 'hsl(145, 65%, 45%)',
  Assicurazioni: 'hsl(45, 100%, 50%)',
  Protecta: 'hsl(330, 70%, 50%)',
  'Extra Gara': 'hsl(180, 60%, 45%)',
};

const PISTA_ICONS: Record<string, React.ReactNode> = {
  Mobile: <Smartphone className="h-4 w-4" />,
  Fisso: <Wifi className="h-4 w-4" />,
  Partnership: <Users className="h-4 w-4" />,
  Energia: <Zap className="h-4 w-4" />,
  Assicurazioni: <Shield className="h-4 w-4" />,
  Protecta: <Award className="h-4 w-4" />,
};

/* ── label maps ─────────────────────────────────────────────── */
const mobileLabel = (type: string) =>
  MOBILE_CATEGORY_LABELS.find((c) => c.value === type)?.label || type;

const FISSO_LABELS: Record<string, string> = {
  FISSO_FTTC: 'Fisso FTTC',
  FISSO_FTTH: 'Fisso FTTH',
  FISSO_FWA_OUT: 'FWA OUT',
  FISSO_FWA_IND_2P: 'FWA IND 2P',
  FRITZ_BOX: 'FRITZ!Box',
  NETFLIX_CON_ADV: 'Netflix con ADV',
  NETFLIX_SENZA_ADV: 'Netflix senza ADV',
  CONVERGENZA: 'Convergenza',
  LINEA_ATTIVA: 'Linea Attiva',
  FISSO_PIVA_1A_LINEA: 'Fisso P.IVA 1ª Linea',
  FISSO_PIVA_2A_LINEA: 'Fisso P.IVA 2ª Linea',
  CHIAMATE_ILLIMITATE: 'Chiamate Illimitate',
  BOLLETTINO_POSTALE: 'Bollettino Postale',
  PIU_SICURI_CASA_UFFICIO: 'Più Sicuri Casa/Ufficio',
  ASSICURAZIONI_PLUS_FULL: 'Assicurazioni Plus Full',
  MIGRAZIONI_FTTH_FWA: 'Migrazioni FTTH/FWA',
};

const ENERGIA_LABELS: Record<string, string> = {
  CONSUMER_CON_SDD: 'Consumer con SDD',
  CONSUMER_NO_SDD: 'Consumer no SDD',
  BUSINESS_CON_SDD: 'Business con SDD',
  BUSINESS_NO_SDD: 'Business no SDD',
  CONSUMER_CON_SDD_W3: 'Consumer con SDD (ex W3)',
  CONSUMER_NO_SDD_W3: 'Consumer no SDD (ex W3)',
  BUSINESS_CON_SDD_W3: 'Business con SDD (ex W3)',
  BUSINESS_NO_SDD_W3: 'Business no SDD (ex W3)',
};

const ASSICURAZIONI_LABELS: Record<string, string> = {
  casaFamigliaFull: 'Casa Famiglia Full',
  casaFamigliaPlus: 'Casa Famiglia Plus',
  casaFamigliaStart: 'Casa Famiglia Start',
  elettrodomestici: 'Elettrodomestici',
  micioFido: 'Micio Fido',
  sportFamiglia: 'Sport Famiglia',
  sportIndividuale: 'Sport Individuale',
  viaggiVacanze: 'Viaggi Vacanze',
  viaggioMondo: 'Viaggio Mondo',
  protezionePro: 'Protezione Pro',
  reloadForever: 'Reload Forever',
};

const PROTECTA_LABELS: Record<string, string> = {
  casaStart: 'Casa Start',
  casaStartFinanziato: 'Casa Start Finanziato',
  casaPlus: 'Casa Plus',
  casaPlusFinanziato: 'Casa Plus Finanziato',
  negozioProtetti: 'Negozio Protetti',
  negozioProtettiFinanziato: 'Negozio Protetti Finanziato',
};

const CB_LABELS: Record<string, string> = {
  cambio_offerta_untied: 'Cambio Offerta Untied',
  cambio_offerta_rivincoli: 'Cambio Offerta Rivincoli',
  cambio_offerta_smart_pack: 'Cambio Offerta Smart Pack OTP',
  telefono_incluso_var: 'Telefono Incluso',
  telefono_incluso_smart_pack_compass_findomestic: 'Smart Pack Compass/Findomestic',
  multi_device_standard: 'Multi Device Standard',
  multi_device_finanziamento: 'Multi Device Finanziamento',
  addon_ricorrenti_mensile_low: 'Add On ≤ 9.99€',
  addon_ricorrenti_mensile_high: 'Add On ≥ 9.99€',
  addon_one_off: 'Add On One Off',
  addon_unlimited_giga: 'Unlimited Giga Boom',
  opzione_piu_sicuri_pro: 'Più Sicuri Mobile Pro',
  opzione_piu_sicuri: 'Più Sicuri Mobile',
  reload_exchange: 'Reload Exchange',
  gestione_cambia_telefono: 'Cambia Telefono Reload Plus',
  windtre_goplay: 'WindTre GoPlay',
  buy_tied: 'BUY TIED',
  buy_untied: 'BUY UNTIED',
  migrazione_ftth: 'Migraz. FTTH',
  migrazione_ftth_extra: 'Migraz. FTTH EXTRA',
  migrazione_fwa_indoor_outdoor: 'Migraz. FWA Indoor/Outdoor',
  migrazione_super_fibra_professional: 'Migraz. Super Fibra Professional',
  migrazione_fttc: 'Migraz. FTTC',
  migrazione_casa_professional: 'Migraz. Casa/Professional',
  offerta_superfibra_netflix_no_adv: 'Superfibra Netflix no ADV',
  offerta_superfibra_netflix_adv: 'Superfibra Netflix con ADV',
  piu_sicuri_casa_ufficio: 'Più Sicuri Casa/Ufficio',
  cambio_piano_fisso: 'Cambio Piano Fisso CB',
  cambio_offerta_microbusiness: 'Cambio Off. Microbusiness',
  sostituzione_sim_3g: 'Sostituzione SIM 3G',
  roaming_itz_piva: 'Roaming ITZ P.IVA',
  pagamento_fatture_pinpad: 'Pagamento Fatture Pinpad',
};

/* ── helpers ─────────────────────────────────────────────────── */
const formatCurrency = (value: number) => {
  if (isNaN(value) || !value) return '€ 0';
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
};

const sogliaLabel = (soglia: number | undefined) => {
  if (soglia === undefined || soglia === null || soglia <= 0) return null;
  return `S${soglia}`;
};

/* ── types ───────────────────────────────────────────────────── */
interface DetailItem {
  label: string;
  pezzi: number;
}

interface RsPistaData {
  pista: string;
  volumi: number;
  premio: number;
  punti: number;
  soglia?: number;
  color: string;
  details: DetailItem[];
}

interface RsDetail {
  rsName: string;
  numPdv: number;
  piste: RsPistaData[];
  premioTotale: number;
  volumiTotali: number;
}

interface RsDrillDownProps {
  preventivo: Preventivo;
  forceExpandAll?: boolean;
}

const MOBILE_SIM_TYPES = [
  'TIED', 'UNTIED', 'TOURIST_FULL', 'TOURIST_PASS', 'TOURIST_XXL',
  'PROFESSIONAL_FLEX', 'PROFESSIONAL_DATA_10', 'PROFESSIONAL_SPECIAL',
  'PROFESSIONAL_STAFF', 'PROFESSIONAL_WORLD', 'ALTRE_SIM_IVA',
];
const FISSO_PEZZI_CATEGORIE = ['FISSO_FTTC', 'FISSO_FTTH', 'FISSO_FWA_OUT', 'FISSO_FWA_IND_2P'];

/* ── main component ──────────────────────────────────────────── */
export function RsDrillDown({ preventivo, forceExpandAll = false }: RsDrillDownProps) {
  const rsDetails = useMemo<RsDetail[]>(() => {
    const data = preventivo.data as Record<string, unknown>;

    const puntiVendita = (data?.puntiVendita as Array<{
      id?: string;
      codicePos?: string;
      nome?: string;
      ragioneSociale?: string;
    }>) || [];

    // Collect all RS names (from all ByRS maps)
    const attivatoMobileByRS = data?.attivatoMobileByRS as Record<string, Array<{ pezzi?: number; type?: string }>> | undefined;
    const attivatoFissoByRS = data?.attivatoFissoByRS as Record<string, Array<{ pezzi?: number; categoria?: string }>> | undefined;
    const attivatoCBByRS = data?.attivatoCBByRS as Record<string, Array<{ pezzi?: number; eventType?: string; clusterCard?: string }>> | undefined;
    const attivatoEnergiaByRS = data?.attivatoEnergiaByRS as Record<string, Array<{ pezzi?: number; category?: string }>> | undefined;
    const attivatoAssicurazioniByRS = data?.attivatoAssicurazioniByRS as Record<string, Record<string, number>> | undefined;
    const attivatoProtectaByRS = data?.attivatoProtectaByRS as Record<string, Record<string, number>> | undefined;

    const risultatoMobile = data?.risultatoMobile as { totale?: number; perPos?: Array<Record<string, unknown>> } | undefined;
    const risultatoFisso = data?.risultatoFisso as { totale?: number; perPos?: Array<Record<string, unknown>> } | undefined;
    const risultatoPartnership = data?.risultatoPartnership as { totale?: number } | undefined;
    const risultatoEnergia = data?.risultatoEnergia as { totale?: number } | undefined;
    const risultatoAssicurazioni = data?.risultatoAssicurazioni as { totalePremio?: number } | undefined;
    const risultatoProtecta = data?.risultatoProtecta as { totalePremio?: number } | undefined;
    const risultatoExtraGaraIva = data?.risultatoExtraGaraIva as {
      totalePremio?: number;
      perRs?: Array<{ ragioneSociale?: string; sogliaRaggiunta?: number; premioTotale?: number }>;
    } | undefined;

    // Get all unique RS names
    const allRsNames = new Set<string>();
    [attivatoMobileByRS, attivatoFissoByRS, attivatoCBByRS, attivatoEnergiaByRS, attivatoAssicurazioniByRS, attivatoProtectaByRS]
      .forEach((map) => {
        if (map) Object.keys(map).forEach((k) => allRsNames.add(k));
      });

    if (allRsNames.size === 0) return [];

    const totalRS = allRsNames.size;

    // Build map: rsName -> list of PDV codes in that RS
    const rsToPdvCodes: Record<string, string[]> = {};
    puntiVendita.forEach((pv) => {
      const rs = pv.ragioneSociale || 'Senza RS';
      const code = pv.codicePos || pv.id || '';
      if (!rsToPdvCodes[rs]) rsToPdvCodes[rs] = [];
      if (code) rsToPdvCodes[rs].push(code);
    });

    // Build prize lookup maps per PDV code
    const mobileByCode: Record<string, Record<string, unknown>> = {};
    const fissoByCode: Record<string, Record<string, unknown>> = {};
    risultatoMobile?.perPos?.forEach((pos) => {
      const code = (pos.pdvCodice as string) || (pos.posCode as string) || '';
      if (code) mobileByCode[code] = pos;
    });
    risultatoFisso?.perPos?.forEach((pos) => {
      const code = (pos.pdvCodice as string) || (pos.posCode as string) || '';
      if (code) fissoByCode[code] = pos;
    });

    return Array.from(allRsNames).map((rsName) => {
      const pdvCodes = rsToPdvCodes[rsName] || [];
      const numPdv = puntiVendita.filter((p) => (p.ragioneSociale || 'Senza RS') === rsName).length;
      const isSingleRS = totalRS === 1;
      const piste: RsPistaData[] = [];

      /* ── Mobile ── */
      const mobileRaw = attivatoMobileByRS?.[rsName] || [];
      const volumiMobile = mobileRaw
        .filter((r) => MOBILE_SIM_TYPES.includes(r.type || ''))
        .reduce((sum, r) => sum + (r.pezzi || 0), 0);

      let premioMobile = 0;
      let puntiMobile = 0;
      let sogliaMobile: number | undefined;
      pdvCodes.forEach((code) => {
        const res = mobileByCode[code];
        if (res) {
          premioMobile += (res.premio as number) || 0;
          puntiMobile += (res.punti as number) || 0;
          const s = res.soglia as number | undefined;
          if (s && (!sogliaMobile || s > sogliaMobile)) sogliaMobile = s;
        }
      });

      const mobileDetails: DetailItem[] = mobileRaw
        .filter((r) => (r.pezzi || 0) > 0)
        .map((r) => ({ label: mobileLabel(r.type || ''), pezzi: r.pezzi || 0 }));

      piste.push({
        pista: 'Mobile',
        volumi: volumiMobile,
        premio: isNaN(premioMobile) ? 0 : premioMobile,
        punti: isNaN(puntiMobile) ? 0 : puntiMobile,
        soglia: sogliaMobile,
        color: CATEGORY_COLORS.Mobile,
        details: mobileDetails,
      });

      /* ── Fisso ── */
      const fissoRaw = attivatoFissoByRS?.[rsName] || [];
      const volumiFisso = fissoRaw
        .filter((r) => FISSO_PEZZI_CATEGORIE.includes(r.categoria || ''))
        .reduce((sum, r) => sum + (r.pezzi || 0), 0);

      let premioFisso = 0;
      let puntiFisso = 0;
      let sogliaFisso: number | undefined;
      pdvCodes.forEach((code) => {
        const res = fissoByCode[code];
        if (res) {
          premioFisso += (res.premio as number) || 0;
          puntiFisso += (res.punti as number) || 0;
          const s = res.soglia as number | undefined;
          if (s && (!sogliaFisso || s > sogliaFisso)) sogliaFisso = s;
        }
      });

      const fissoDetails: DetailItem[] = fissoRaw
        .filter((r) => (r.pezzi || 0) > 0)
        .map((r) => ({
          label: FISSO_LABELS[r.categoria || ''] || r.categoria || '',
          pezzi: r.pezzi || 0,
        }));

      piste.push({
        pista: 'Fisso',
        volumi: volumiFisso,
        premio: isNaN(premioFisso) ? 0 : premioFisso,
        punti: isNaN(puntiFisso) ? 0 : puntiFisso,
        soglia: sogliaFisso,
        color: CATEGORY_COLORS.Fisso,
        details: fissoDetails,
      });

      /* ── Partnership ── */
      const cbRaw = attivatoCBByRS?.[rsName] || [];
      const volumiPartnership = cbRaw.reduce((sum, r) => sum + (r.pezzi || 0), 0);
      const cbByKey: Record<string, { label: string; pezzi: number }> = {};
      cbRaw.forEach((r) => {
        if ((r.pezzi || 0) > 0) {
          const key = r.eventType || 'altro';
          const label = CB_LABELS[key] || key;
          if (cbByKey[key]) cbByKey[key].pezzi += r.pezzi || 0;
          else cbByKey[key] = { label, pezzi: r.pezzi || 0 };
        }
      });

      piste.push({
        pista: 'Partnership',
        volumi: volumiPartnership,
        premio: isSingleRS ? (risultatoPartnership?.totale || 0) : 0,
        punti: 0,
        color: CATEGORY_COLORS.Partnership,
        details: Object.values(cbByKey),
      });

      /* ── Energia ── */
      const energiaRaw = attivatoEnergiaByRS?.[rsName] || [];
      const volumiEnergia = energiaRaw.reduce((sum, r) => sum + (r.pezzi || 0), 0);
      const energiaDetails: DetailItem[] = energiaRaw
        .filter((r) => (r.pezzi || 0) > 0)
        .map((r) => ({
          label: ENERGIA_LABELS[r.category || ''] || r.category || '',
          pezzi: r.pezzi || 0,
        }));

      piste.push({
        pista: 'Energia',
        volumi: volumiEnergia,
        premio: isSingleRS ? (risultatoEnergia?.totale || 0) : 0,
        punti: 0,
        color: CATEGORY_COLORS.Energia,
        details: energiaDetails,
      });

      /* ── Assicurazioni ── */
      const assicRaw = attivatoAssicurazioniByRS?.[rsName];
      let volumiAssic = 0;
      const assicDetails: DetailItem[] = [];
      if (assicRaw && typeof assicRaw === 'object') {
        Object.entries(assicRaw).forEach(([key, val]) => {
          if (typeof val === 'number' && key !== 'viaggioMondoPremio' && val > 0) {
            volumiAssic += val;
            assicDetails.push({ label: ASSICURAZIONI_LABELS[key] || key, pezzi: val });
          }
        });
      }

      piste.push({
        pista: 'Assicurazioni',
        volumi: volumiAssic,
        premio: isSingleRS ? (risultatoAssicurazioni?.totalePremio || 0) : 0,
        punti: 0,
        color: CATEGORY_COLORS.Assicurazioni,
        details: assicDetails,
      });

      /* ── Protecta ── */
      const protRaw = attivatoProtectaByRS?.[rsName];
      let volumiProtecta = 0;
      const protDetails: DetailItem[] = [];
      if (protRaw && typeof protRaw === 'object') {
        Object.entries(protRaw).forEach(([key, val]) => {
          if (typeof val === 'number' && val > 0) {
            volumiProtecta += val;
            protDetails.push({ label: PROTECTA_LABELS[key] || key, pezzi: val });
          }
        });
      }

      piste.push({
        pista: 'Protecta',
        volumi: volumiProtecta,
        premio: isSingleRS ? (risultatoProtecta?.totalePremio || 0) : 0,
        punti: 0,
        color: CATEGORY_COLORS.Protecta,
        details: protDetails,
      });

      /* ── Extra Gara ── */
      const extraRs = risultatoExtraGaraIva?.perRs?.find(
        (r) => (r.ragioneSociale || '').trim().toLowerCase() === rsName.trim().toLowerCase()
      );
      piste.push({
        pista: 'Extra Gara',
        volumi: 0,
        premio: extraRs?.premioTotale || 0,
        punti: 0,
        soglia: extraRs?.sogliaRaggiunta,
        color: CATEGORY_COLORS['Extra Gara'],
        details: [],
      });

      const premioTotale = piste.reduce((sum, p) => sum + p.premio, 0);
      const volumiTotali = piste.reduce((sum, p) => sum + p.volumi, 0);

      return { rsName, numPdv, piste, premioTotale, volumiTotali };
    }).sort((a, b) => b.premioTotale - a.premioTotale || b.volumiTotali - a.volumiTotali);
  }, [preventivo]);

  if (rsDetails.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          Vedi Dettagli per Ragione Sociale
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Espandi una RS per visualizzare volumi e premi di ogni pista ({rsDetails.length} Ragion{rsDetails.length === 1 ? 'e Sociale' : 'i Sociali'})
        </p>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="space-y-2" defaultValue={forceExpandAll ? rsDetails.map(r => r.rsName) : undefined}>
          {rsDetails.map((rs) => (
            <AccordionItem key={rs.rsName} value={rs.rsName} className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center justify-between w-full pr-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Building2 className="h-4 w-4 text-primary" />
                    </div>
                    <div className="text-left">
                      <div className="font-semibold text-sm">{rs.rsName}</div>
                      <div className="text-xs text-muted-foreground">{rs.numPdv} PDV</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-xs">
                      {rs.volumiTotali} pezzi
                    </Badge>
                    {rs.premioTotale > 0 && (
                      <Badge className="text-xs bg-primary/10 text-primary border-primary/20">
                        {formatCurrency(rs.premioTotale)}
                      </Badge>
                    )}
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <RsDetailContent rs={rs} forceExpandAll={forceExpandAll} />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}

/* ── detail content per RS ───────────────────────────────────── */
function RsDetailContent({ rs, forceExpandAll = false }: { rs: RsDetail; forceExpandAll?: boolean }) {
  const pisteConDati = rs.piste.filter((p) => p.volumi > 0 || p.premio > 0);

  if (pisteConDati.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        Nessun volume inserito per questa Ragione Sociale
      </div>
    );
  }

  const chartData = pisteConDati.map((p) => ({
    name: p.pista,
    volumi: p.volumi,
    premio: p.premio,
    fill: p.color,
  }));

  const hasPremi = pisteConDati.some((p) => p.premio > 0);

  return (
    <div className="space-y-4 pb-2">
      {/* Charts — tenuti insieme in stampa */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print:break-inside-avoid">
        {pisteConDati.some((p) => p.volumi > 0) && (
          <div className="bg-muted/30 rounded-lg p-4">
            <h4 className="text-sm font-medium mb-3">Volumi per Pista</h4>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData.filter((d) => d.volumi > 0)} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis dataKey="name" className="text-xs" tick={{ fontSize: 11 }} />
                <YAxis className="text-xs" tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number) => [value, 'Volumi']}
                />
                <Bar dataKey="volumi" radius={[4, 4, 0, 0]}>
                  {chartData.filter((d) => d.volumi > 0).map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {hasPremi && (
          <div className="bg-muted/30 rounded-lg p-4">
            <h4 className="text-sm font-medium mb-3">Premi per Pista</h4>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={chartData.filter((d) => d.premio > 0)}
                margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis dataKey="name" className="text-xs" tick={{ fontSize: 11 }} />
                <YAxis className="text-xs" tick={{ fontSize: 11 }} tickFormatter={(v) => `€${v}`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number) => [formatCurrency(value), 'Premio']}
                />
                <Bar dataKey="premio" radius={[4, 4, 0, 0]}>
                  {chartData.filter((d) => d.premio > 0).map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Detail Table — inizia su pagina nuova in stampa */}
      <div className="rounded-lg border overflow-hidden print:break-before-page print:overflow-visible">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left p-3 font-medium">Pista</th>
              <th className="text-center p-3 font-medium">Volumi</th>
              <th className="text-center p-3 font-medium">Punti</th>
              <th className="text-center p-3 font-medium">Soglia</th>
              <th className="text-right p-3 font-medium">Premio €</th>
            </tr>
          </thead>
          <tbody>
            {pisteConDati.map((p) => (
              <PistaExpandableRow key={p.pista} pista={p} forceOpen={forceExpandAll} />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30 font-semibold">
              <td className="p-3">Totale</td>
              <td className="p-3 text-center">{rs.volumiTotali}</td>
              <td className="p-3 text-center">
                {pisteConDati.reduce((s, p) => s + p.punti, 0) > 0
                  ? Math.round(pisteConDati.reduce((s, p) => s + p.punti, 0))
                  : '–'}
              </td>
              <td className="p-3 text-center">–</td>
              <td className="p-3 text-right text-primary">
                {rs.premioTotale > 0 ? formatCurrency(rs.premioTotale) : '–'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ── expandable pista row ────────────────────────────────────── */
function PistaExpandableRow({ pista, forceOpen = false }: { pista: RsPistaData; forceOpen?: boolean }) {
  const [open, setOpen] = useState(forceOpen);
  const hasDetails = pista.details.length > 0;
  const isOpen = forceOpen || open;
  const soglia = sogliaLabel(pista.soglia);

  return (
    <>
      <tr
        className={`border-t transition-colors ${hasDetails ? 'cursor-pointer hover:bg-muted/30' : ''}`}
        onClick={() => hasDetails && setOpen(!open)}
      >
        <td className="p-3">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: pista.color }} />
            <div className="flex items-center gap-1.5">
              {PISTA_ICONS[pista.pista]}
              <span className="font-medium">{pista.pista}</span>
            </div>
            {hasDetails && (
              <ChevronDown
                className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
              />
            )}
          </div>
        </td>
        <td className="p-3 text-center">
          <Badge variant="outline">{pista.volumi}</Badge>
        </td>
        <td className="p-3 text-center text-muted-foreground">
          {pista.punti > 0 ? Math.round(pista.punti) : '–'}
        </td>
        <td className="p-3 text-center">
          {soglia ? (
            <Badge className="text-xs bg-primary/10 text-primary border-primary/20">{soglia}</Badge>
          ) : '–'}
        </td>
        <td className="p-3 text-right font-semibold">
          {pista.premio > 0 ? formatCurrency(pista.premio) : '–'}
        </td>
      </tr>
      {isOpen && hasDetails && (
        <tr>
          <td colSpan={5} className="p-0">
            <div className="bg-muted/20 border-t px-6 py-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {pista.details.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-md bg-background px-3 py-1.5 text-xs border"
                  >
                    <span className="text-muted-foreground truncate">{d.label}</span>
                    <span className="font-semibold shrink-0">{d.pezzi}</span>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
