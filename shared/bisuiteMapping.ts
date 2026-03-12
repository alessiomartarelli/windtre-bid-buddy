export type GaraPista = 'mobile' | 'fisso' | 'energia' | 'assicurazioni' | 'protecta' | 'partnership';

export interface BiSuiteMappingCondition {
  categoriaBiSuite?: string;
  tipologiaBiSuite?: string;
  clienteTipo?: string;
  domandaTesto?: string;
  rispostaContiene?: string;
}

export interface BiSuiteMappingRule {
  id: string;
  pista: GaraPista;
  targetCategory: string;
  targetLabel: string;
  conditions: BiSuiteMappingCondition;
  priority: number;
  enabled: boolean;
}

export interface BiSuiteMappingConfig {
  rules: BiSuiteMappingRule[];
  version: string;
}

export const MOBILE_TARGETS = [
  { value: 'TIED', label: 'Tied' },
  { value: 'UNTIED', label: 'Untied' },
  { value: 'SIM_CNS', label: 'SIM Consumer' },
  { value: 'SIM_IVA', label: 'SIM IVA' },
  { value: 'PROFESSIONAL_FLEX', label: 'Professional Flex' },
  { value: 'PROFESSIONAL_DATA_10', label: 'Professional Data 10' },
  { value: 'PROFESSIONAL_SPECIAL', label: 'Professional Special' },
  { value: 'PROFESSIONAL_STAFF', label: 'Professional Staff' },
  { value: 'PROFESSIONAL_WORLD', label: 'Professional World' },
  { value: 'ALTRE_SIM_IVA', label: 'Altre SIM IVA' },
  { value: 'PHASE_IN_TIED', label: 'Phase In Tied' },
  { value: 'WINBACK', label: 'WinBack' },
  { value: 'CONVERGENTE_SUPERFIBRA_MULTISERVICE', label: 'Convergente Superfibra / Multiservice' },
  { value: 'TOURIST_FULL', label: 'Tourist Full' },
  { value: 'TOURIST_PASS', label: 'Tourist Pass' },
  { value: 'TOURIST_XXL', label: 'Tourist XXL' },
  { value: 'MNP', label: 'MNP' },
  { value: 'MNP_MVNO', label: 'MNP da MVNO' },
  { value: 'PIU_SICURI_MOBILE', label: 'Più Sicuri Mobile' },
  { value: 'PIU_SICURI_MOBILE_PRO', label: 'Più Sicuri Mobile Pro' },
  { value: 'RELOAD_EXCHANGE', label: 'Reload Exchange' },
  { value: 'DEVICE_1_FIN_SP_LT_200', label: '1° Device finanziato SP < 200€' },
  { value: 'DEVICE_1_FIN_SP_200_600', label: '1° Device finanziato 200–600€' },
  { value: 'DEVICE_1_FIN_SP_GTE_600', label: '1° Device finanziato ≥ 600€' },
  { value: 'DEVICE_VAR_SP_LT_200', label: 'Device VAR < 200€' },
  { value: 'DEVICE_VAR_SP_GTE_200', label: 'Device VAR ≥ 200€' },
  { value: 'DEVICE_2_FINANZIATO', label: '2° Device' },
];

export const FISSO_TARGETS = [
  { value: 'FISSO_FTTC', label: 'Fisso FTTC' },
  { value: 'FISSO_FTTH', label: 'Fisso FTTH' },
  { value: 'FISSO_FWA_OUT', label: 'FWA OUT' },
  { value: 'FISSO_FWA_IND_2P', label: 'FWA IND 2P' },
  { value: 'FRITZ_BOX', label: 'FRITZ!Box' },
  { value: 'NETFLIX_CON_ADV', label: 'Netflix con ADV' },
  { value: 'NETFLIX_SENZA_ADV', label: 'Netflix senza ADV' },
  { value: 'CONVERGENZA', label: 'Convergenza' },
  { value: 'LINEA_ATTIVA', label: 'Linea Attiva' },
  { value: 'FISSO_PIVA_1A_LINEA', label: 'Fisso P.IVA 1ª Linea' },
  { value: 'FISSO_PIVA_2A_LINEA', label: 'Fisso P.IVA 2ª Linea' },
  { value: 'CHIAMATE_ILLIMITATE', label: 'Chiamate Illimitate' },
  { value: 'BOLLETTINO_POSTALE', label: 'Bollettino Postale' },
  { value: 'PIU_SICURI_CASA_UFFICIO', label: 'Più Sicuri Casa/Ufficio' },
  { value: 'ASSICURAZIONI_PLUS_FULL', label: 'Assicurazioni Plus Full' },
  { value: 'MIGRAZIONI_FTTH_FWA', label: 'Migrazioni FTTH/FWA' },
];

export const ENERGIA_TARGETS = [
  { value: 'CONSUMER_CON_SDD', label: 'Consumer con SDD' },
  { value: 'CONSUMER_NO_SDD', label: 'Consumer no SDD' },
  { value: 'BUSINESS_CON_SDD', label: 'Business con SDD' },
  { value: 'BUSINESS_NO_SDD', label: 'Business no SDD' },
  { value: 'CONSUMER_CON_SDD_W3', label: 'Consumer con SDD (ex W3)' },
  { value: 'CONSUMER_NO_SDD_W3', label: 'Consumer no SDD (ex W3)' },
  { value: 'BUSINESS_CON_SDD_W3', label: 'Business con SDD (ex W3)' },
  { value: 'BUSINESS_NO_SDD_W3', label: 'Business no SDD (ex W3)' },
];

export const ASSICURAZIONI_TARGETS = [
  { value: 'casaFamigliaFull', label: 'Casa Famiglia Full' },
  { value: 'casaFamigliaPlus', label: 'Casa Famiglia Plus' },
  { value: 'casaFamigliaStart', label: 'Casa Famiglia Start' },
  { value: 'elettrodomestici', label: 'Elettrodomestici' },
  { value: 'micioFido', label: 'Micio Fido' },
  { value: 'sportFamiglia', label: 'Sport Famiglia' },
  { value: 'sportIndividuale', label: 'Sport Individuale' },
  { value: 'viaggiVacanze', label: 'Viaggi Vacanze' },
  { value: 'viaggioMondo', label: 'Viaggio Mondo' },
  { value: 'protezionePro', label: 'Protezione Pro' },
  { value: 'reloadForever', label: 'Reload Forever' },
];

export const PROTECTA_TARGETS = [
  { value: 'casaStart', label: 'Casa Start' },
  { value: 'casaStartFinanziato', label: 'Casa Start Finanziato' },
  { value: 'casaPlus', label: 'Casa Plus' },
  { value: 'casaPlusFinanziato', label: 'Casa Plus Finanziato' },
  { value: 'negozioProtetti', label: 'Negozio Protetti' },
  { value: 'negozioProtettiFinanziato', label: 'Negozio Protetti Finanziato' },
];

export const PARTNERSHIP_TARGETS = [
  { value: 'cambio_offerta_untied', label: 'Cambio Offerta Untied' },
  { value: 'cambio_offerta_rivincoli', label: 'Cambio Offerta Rivincoli' },
  { value: 'cambio_offerta_smart_pack', label: 'Cambio Offerta Smart Pack OTP' },
  { value: 'telefono_incluso_var', label: 'Telefono Incluso' },
  { value: 'telefono_incluso_smart_pack_compass_findomestic', label: 'Smart Pack Compass/Findomestic' },
  { value: 'multi_device_standard', label: 'Multi Device Standard' },
  { value: 'multi_device_finanziamento', label: 'Multi Device Finanziamento' },
  { value: 'addon_ricorrenti_mensile_low', label: 'Add On ≤ 9.99€' },
  { value: 'addon_ricorrenti_mensile_high', label: 'Add On ≥ 9.99€' },
  { value: 'addon_one_off', label: 'Add On One Off' },
  { value: 'addon_unlimited_giga', label: 'Unlimited Giga Boom' },
  { value: 'opzione_piu_sicuri_pro', label: 'Più Sicuri Mobile Pro' },
  { value: 'opzione_piu_sicuri', label: 'Più Sicuri Mobile' },
  { value: 'reload_exchange', label: 'Reload Exchange' },
  { value: 'gestione_cambia_telefono', label: 'Cambia Telefono Reload Plus' },
  { value: 'windtre_goplay', label: 'WindTre GoPlay' },
  { value: 'buy_tied', label: 'BUY TIED' },
  { value: 'buy_untied', label: 'BUY UNTIED' },
];

export const PISTA_TARGETS: Record<GaraPista, { value: string; label: string }[]> = {
  mobile: MOBILE_TARGETS,
  fisso: FISSO_TARGETS,
  energia: ENERGIA_TARGETS,
  assicurazioni: ASSICURAZIONI_TARGETS,
  protecta: PROTECTA_TARGETS,
  partnership: PARTNERSHIP_TARGETS,
};

export const PISTA_LABELS: Record<GaraPista, string> = {
  mobile: 'Mobile',
  fisso: 'Fisso',
  energia: 'Energia',
  assicurazioni: 'Assicurazioni',
  protecta: 'Protecta',
  partnership: 'Partnership',
};

let _ruleIdCounter = 0;
function ruleId(): string {
  return `rule-${++_ruleIdCounter}`;
}

export function getDefaultMappingRules(): BiSuiteMappingRule[] {
  return [
    { id: ruleId(), pista: 'mobile', targetCategory: 'TIED', targetLabel: 'Tied', conditions: { categoriaBiSuite: 'TELEFONIA', tipologiaBiSuite: 'SIM', clienteTipo: 'PRIVATO', domandaTesto: 'Tipologia Offerta', rispostaContiene: 'TIED' }, priority: 10, enabled: true },
    { id: ruleId(), pista: 'mobile', targetCategory: 'UNTIED', targetLabel: 'Untied', conditions: { categoriaBiSuite: 'TELEFONIA', tipologiaBiSuite: 'SIM', clienteTipo: 'PRIVATO', domandaTesto: 'Tipologia Offerta', rispostaContiene: 'UNTIED' }, priority: 10, enabled: true },
    { id: ruleId(), pista: 'mobile', targetCategory: 'MNP', targetLabel: 'MNP', conditions: { categoriaBiSuite: 'TELEFONIA', tipologiaBiSuite: 'MNP' }, priority: 15, enabled: true },
    { id: ruleId(), pista: 'mobile', targetCategory: 'WINBACK', targetLabel: 'WinBack', conditions: { categoriaBiSuite: 'TELEFONIA', tipologiaBiSuite: 'WINBACK' }, priority: 15, enabled: true },
    { id: ruleId(), pista: 'mobile', targetCategory: 'PROFESSIONAL_STAFF', targetLabel: 'Professional Staff', conditions: { categoriaBiSuite: 'TELEFONIA', tipologiaBiSuite: 'PROFESSIONAL STAFF', clienteTipo: 'PIVA' }, priority: 20, enabled: true },
    { id: ruleId(), pista: 'mobile', targetCategory: 'PROFESSIONAL_WORLD', targetLabel: 'Professional World', conditions: { categoriaBiSuite: 'TELEFONIA', tipologiaBiSuite: 'PROFESSIONAL WORLD', clienteTipo: 'PIVA' }, priority: 20, enabled: true },
    { id: ruleId(), pista: 'mobile', targetCategory: 'PROFESSIONAL_FLEX', targetLabel: 'Professional Flex', conditions: { categoriaBiSuite: 'TELEFONIA', tipologiaBiSuite: 'PROFESSIONAL FLEX', clienteTipo: 'PIVA' }, priority: 20, enabled: true },
    { id: ruleId(), pista: 'mobile', targetCategory: 'SIM_CNS', targetLabel: 'SIM Consumer', conditions: { categoriaBiSuite: 'TELEFONIA', tipologiaBiSuite: 'SIM', clienteTipo: 'PRIVATO' }, priority: 5, enabled: true },
    { id: ruleId(), pista: 'mobile', targetCategory: 'SIM_IVA', targetLabel: 'SIM IVA', conditions: { categoriaBiSuite: 'TELEFONIA', tipologiaBiSuite: 'SIM', clienteTipo: 'PIVA' }, priority: 5, enabled: true },

    { id: ruleId(), pista: 'fisso', targetCategory: 'FISSO_FTTC', targetLabel: 'Fisso FTTC', conditions: { categoriaBiSuite: 'FISSO', tipologiaBiSuite: 'FTTC' }, priority: 10, enabled: true },
    { id: ruleId(), pista: 'fisso', targetCategory: 'FISSO_FTTH', targetLabel: 'Fisso FTTH', conditions: { categoriaBiSuite: 'FISSO', tipologiaBiSuite: 'FTTH' }, priority: 10, enabled: true },
    { id: ruleId(), pista: 'fisso', targetCategory: 'FISSO_FWA_OUT', targetLabel: 'FWA OUT', conditions: { categoriaBiSuite: 'FISSO', tipologiaBiSuite: 'FWA OUTDOOR' }, priority: 10, enabled: true },
    { id: ruleId(), pista: 'fisso', targetCategory: 'FISSO_FWA_IND_2P', targetLabel: 'FWA IND 2P', conditions: { categoriaBiSuite: 'FISSO', tipologiaBiSuite: 'FWA INDOOR' }, priority: 10, enabled: true },
    { id: ruleId(), pista: 'fisso', targetCategory: 'FISSO_PIVA_1A_LINEA', targetLabel: 'Fisso P.IVA 1ª Linea', conditions: { categoriaBiSuite: 'FISSO', clienteTipo: 'PIVA' }, priority: 5, enabled: true },
    { id: ruleId(), pista: 'fisso', targetCategory: 'CONVERGENZA', targetLabel: 'Convergenza', conditions: { categoriaBiSuite: 'FISSO', tipologiaBiSuite: 'CONVERGENZA' }, priority: 10, enabled: true },

    { id: ruleId(), pista: 'energia', targetCategory: 'CONSUMER_CON_SDD', targetLabel: 'Consumer con SDD', conditions: { categoriaBiSuite: 'ENERGIA', clienteTipo: 'PRIVATO', domandaTesto: 'SDD', rispostaContiene: 'SI' }, priority: 10, enabled: true },
    { id: ruleId(), pista: 'energia', targetCategory: 'CONSUMER_NO_SDD', targetLabel: 'Consumer no SDD', conditions: { categoriaBiSuite: 'ENERGIA', clienteTipo: 'PRIVATO' }, priority: 5, enabled: true },
    { id: ruleId(), pista: 'energia', targetCategory: 'BUSINESS_CON_SDD', targetLabel: 'Business con SDD', conditions: { categoriaBiSuite: 'ENERGIA', clienteTipo: 'PIVA', domandaTesto: 'SDD', rispostaContiene: 'SI' }, priority: 10, enabled: true },
    { id: ruleId(), pista: 'energia', targetCategory: 'BUSINESS_NO_SDD', targetLabel: 'Business no SDD', conditions: { categoriaBiSuite: 'ENERGIA', clienteTipo: 'PIVA' }, priority: 5, enabled: true },

    { id: ruleId(), pista: 'assicurazioni', targetCategory: 'protezionePro', targetLabel: 'Protezione Pro', conditions: { categoriaBiSuite: 'ASSICURAZIONI', tipologiaBiSuite: 'PROTEZIONE PRO' }, priority: 10, enabled: true },
    { id: ruleId(), pista: 'assicurazioni', targetCategory: 'casaFamigliaFull', targetLabel: 'Casa Famiglia Full', conditions: { categoriaBiSuite: 'ASSICURAZIONI', tipologiaBiSuite: 'CASA FAMIGLIA FULL' }, priority: 10, enabled: true },

    { id: ruleId(), pista: 'protecta', targetCategory: 'negozioProtetti', targetLabel: 'Negozio Protetti', conditions: { categoriaBiSuite: 'PROTECTA', tipologiaBiSuite: 'NEGOZIO PROTETTI' }, priority: 10, enabled: true },
    { id: ruleId(), pista: 'protecta', targetCategory: 'casaStart', targetLabel: 'Casa Start', conditions: { categoriaBiSuite: 'PROTECTA', tipologiaBiSuite: 'CASA START' }, priority: 10, enabled: true },

    { id: ruleId(), pista: 'partnership', targetCategory: 'cambio_offerta_untied', targetLabel: 'Cambio Offerta Untied', conditions: { categoriaBiSuite: 'CUSTOMER BASE', tipologiaBiSuite: 'CAMBIO OFFERTA UNTIED' }, priority: 10, enabled: true },
    { id: ruleId(), pista: 'partnership', targetCategory: 'cambio_offerta_rivincoli', targetLabel: 'Cambio Offerta Rivincoli', conditions: { categoriaBiSuite: 'CUSTOMER BASE', tipologiaBiSuite: 'CAMBIO OFFERTA RIVINCOLI' }, priority: 10, enabled: true },
  ];
}

export interface BiSuiteArticolo {
  categoria?: { nome?: string };
  tipologia?: { nome?: string };
  tipo?: string;
  dettaglio?: {
    domandeRisposte?: Array<{
      domandaTesto?: string;
      risposta?: string;
    }>;
  };
}

export interface BiSuiteSaleForMapping {
  cliente?: { clienteTipo?: string };
  articoli?: BiSuiteArticolo[];
}

export interface MappedArticle {
  pista: GaraPista;
  targetCategory: string;
  targetLabel: string;
  ruleId: string;
}

function matchesCondition(
  condition: BiSuiteMappingCondition,
  articolo: BiSuiteArticolo,
  clienteTipo: string
): boolean {
  const catNome = (articolo.categoria?.nome || '').toUpperCase().trim();
  const tipNome = (articolo.tipologia?.nome || '').toUpperCase().trim();
  const cTipo = clienteTipo.toUpperCase().trim();

  if (condition.categoriaBiSuite) {
    if (catNome !== condition.categoriaBiSuite.toUpperCase().trim()) return false;
  }

  if (condition.tipologiaBiSuite) {
    const condTip = condition.tipologiaBiSuite.toUpperCase().trim();
    if (!tipNome.includes(condTip) && condTip !== tipNome) return false;
  }

  if (condition.clienteTipo) {
    const condClient = condition.clienteTipo.toUpperCase().trim();
    if (cTipo !== condClient) return false;
  }

  if (condition.domandaTesto && condition.rispostaContiene) {
    const domandeRisposte = articolo.dettaglio?.domandeRisposte || [];
    const domandaTarget = condition.domandaTesto.toUpperCase().trim();
    const rispostaTarget = condition.rispostaContiene.toUpperCase().trim();
    const found = domandeRisposte.some(
      (dr) =>
        (dr.domandaTesto || '').toUpperCase().trim().includes(domandaTarget) &&
        (dr.risposta || '').toUpperCase().trim().includes(rispostaTarget)
    );
    if (!found) return false;
  }

  return true;
}

export function mapBiSuiteArticle(
  articolo: BiSuiteArticolo,
  clienteTipo: string,
  rules: BiSuiteMappingRule[]
): MappedArticle | null {
  const enabledRules = rules
    .filter((r) => r.enabled)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of enabledRules) {
    if (matchesCondition(rule.conditions, articolo, clienteTipo)) {
      return {
        pista: rule.pista,
        targetCategory: rule.targetCategory,
        targetLabel: rule.targetLabel,
        ruleId: rule.id,
      };
    }
  }

  return null;
}

export function mapBiSuiteSale(
  sale: BiSuiteSaleForMapping,
  rules: BiSuiteMappingRule[]
): MappedArticle[] {
  const clienteTipo = sale.cliente?.clienteTipo || '';
  const articoli = sale.articoli || [];
  const results: MappedArticle[] = [];

  for (const art of articoli) {
    const mapped = mapBiSuiteArticle(art, clienteTipo, rules);
    if (mapped) {
      results.push(mapped);
    }
  }

  return results;
}
