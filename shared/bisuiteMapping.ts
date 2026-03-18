export type GaraPista = 'mobile' | 'fisso' | 'energia' | 'assicurazioni' | 'protecta' | 'partnership';

export interface BiSuiteMappingCondition {
  categoriaBiSuite?: string;
  tipologiaBiSuite?: string;
  descrizioneBiSuite?: string;
  descrizioneEscludi?: string;
  clienteTipo?: string;
  domandaTesto?: string;
  rispostaContiene?: string;
  rispostaDiversaDa?: string;
  rispostaEsatta?: string;
  rispostaNumericaUguale?: number;
  rispostaNumericaMaggiore?: number;
  canoneMinimo?: number;
}

export interface BiSuiteMappingRule {
  id: string;
  pista: GaraPista;
  targetCategory: string;
  targetLabel: string;
  conditions: BiSuiteMappingCondition;
  priority: number;
  enabled: boolean;
  ruleType?: 'base' | 'additional';
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
  { value: 'SIM_ALLARME', label: 'SIM Allarme' },
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
  { value: 'FISSO_VOCE', label: 'Fisso Voce' },
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
  { value: 'IMP_AGG_0_VAR_FINANZ', label: 'IMP.AGG=0 VAR/FINANZ' },
  { value: 'IMP_AGG_GT0_FINANZ', label: 'IMP.AGG>0 FINANZ' },
  { value: 'IMP_AGG_GT0_VAR', label: 'IMP.AGG>0 VAR' },
  { value: 'MIGRAZIONI_FTTH_FWA', label: 'Migrazioni FTTH/FWA' },
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
    // ═══════════════ MOBILE — BASE (da categoria+tipologia) ═══════════════
    { id: ruleId(), pista: 'mobile', targetCategory: 'TIED', targetLabel: 'Tied', conditions: { categoriaBiSuite: 'TIED CF', tipologiaBiSuite: 'VOCE EASYPAY' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'TIED', targetLabel: 'Tied', conditions: { categoriaBiSuite: 'TIED CF', tipologiaBiSuite: 'DATI EASYPAY' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'UNTIED', targetLabel: 'Untied', conditions: { categoriaBiSuite: 'UNTIED', tipologiaBiSuite: 'RICARICABILE VOCE' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'UNTIED', targetLabel: 'Untied', conditions: { categoriaBiSuite: 'UNTIED', tipologiaBiSuite: 'RICARICABILE DATI' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'SIM_IVA', targetLabel: 'SIM IVA', conditions: { categoriaBiSuite: 'TIED IVA', tipologiaBiSuite: 'VOCE IVA' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'SIM_IVA', targetLabel: 'SIM IVA', conditions: { categoriaBiSuite: 'TIED IVA', tipologiaBiSuite: 'DATI IVA' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'TOURIST_FULL', targetLabel: 'Tourist Full', conditions: { categoriaBiSuite: 'ALTRE GA', tipologiaBiSuite: 'GA TURISTICHE' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'SIM_ALLARME', targetLabel: 'SIM Allarme', conditions: { categoriaBiSuite: 'ALTRE GA', tipologiaBiSuite: 'ALTRE GA NON TURISTICHE' }, priority: 10, enabled: true, ruleType: 'base' },

    // TIED IVA Professional variants (distinguished by descrizione)
    { id: ruleId(), pista: 'mobile', targetCategory: 'PROFESSIONAL_WORLD', targetLabel: 'Professional World', conditions: { categoriaBiSuite: 'TIED IVA', descrizioneBiSuite: 'PROFESSIONAL WORLD' }, priority: 15, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'PROFESSIONAL_STAFF', targetLabel: 'Professional Staff', conditions: { categoriaBiSuite: 'TIED IVA', descrizioneBiSuite: 'PROFESSIONAL STAFF' }, priority: 15, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'PROFESSIONAL_SPECIAL', targetLabel: 'Professional Special', conditions: { categoriaBiSuite: 'TIED IVA', descrizioneBiSuite: 'PROFESSIONAL SPECIAL' }, priority: 15, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'PROFESSIONAL_FLEX', targetLabel: 'Professional Flex', conditions: { categoriaBiSuite: 'TIED IVA', descrizioneBiSuite: 'PROFESSIONAL FLEX' }, priority: 15, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'PROFESSIONAL_DATA_10', targetLabel: 'Professional Data 10', conditions: { categoriaBiSuite: 'TIED IVA', descrizioneBiSuite: 'PROFESSIONAL DATA 10' }, priority: 15, enabled: true, ruleType: 'base' },

    // ═══════════════ MOBILE — ADDITIONAL (da domande/risposte) ═══════════════
    { id: ruleId(), pista: 'mobile', targetCategory: 'MNP', targetLabel: 'MNP', conditions: { categoriaBiSuite: 'TIED CF', domandaTesto: 'MNP', rispostaDiversaDa: 'NO' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'MNP_MVNO', targetLabel: 'MNP da MVNO', conditions: { categoriaBiSuite: 'TIED CF', domandaTesto: 'MNP DA OPERATORI VIRTUALI', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'CONVERGENTE_SUPERFIBRA_MULTISERVICE', targetLabel: 'Convergente Superfibra / Multiservice', conditions: { categoriaBiSuite: 'TIED CF', domandaTesto: 'GA CONVERGENTE FISSO', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'PIU_SICURI_MOBILE', targetLabel: 'Più Sicuri Mobile', conditions: { categoriaBiSuite: 'TIED CF', domandaTesto: 'PIU SICURI MOBILE', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'PIU_SICURI_MOBILE_PRO', targetLabel: 'Più Sicuri Mobile Pro', conditions: { categoriaBiSuite: 'TIED CF', domandaTesto: 'PIU SICURI MOBILE PRO', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'DEVICE_VAR_SP_LT_200', targetLabel: 'Device VAR < 200€', conditions: { categoriaBiSuite: 'TIED CF', domandaTesto: 'TELEFONO INCLUSO VAR', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'DEVICE_1_FIN_SP_LT_200', targetLabel: '1° Device finanziato SP < 200€', conditions: { categoriaBiSuite: 'TIED CF', domandaTesto: 'TELEFONO INCLUSO COMPASS', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'DEVICE_1_FIN_SP_LT_200', targetLabel: '1° Device finanziato SP < 200€', conditions: { categoriaBiSuite: 'TIED CF', domandaTesto: 'TELEFONO INCLUSO FINDOMESTIC', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },

    { id: ruleId(), pista: 'mobile', targetCategory: 'MNP', targetLabel: 'MNP', conditions: { categoriaBiSuite: 'TIED IVA', domandaTesto: 'MNP', rispostaDiversaDa: 'NO' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'MNP_MVNO', targetLabel: 'MNP da MVNO', conditions: { categoriaBiSuite: 'TIED IVA', domandaTesto: 'MNP DA OPERATORI VIRTUALI', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'PIU_SICURI_MOBILE', targetLabel: 'Più Sicuri Mobile', conditions: { categoriaBiSuite: 'TIED IVA', domandaTesto: 'PIU SICURI MOBILE', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'PIU_SICURI_MOBILE_PRO', targetLabel: 'Più Sicuri Mobile Pro', conditions: { categoriaBiSuite: 'TIED IVA', domandaTesto: 'PIU SICURI MOBILE PRO', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'DEVICE_VAR_SP_LT_200', targetLabel: 'Device VAR < 200€', conditions: { categoriaBiSuite: 'TIED IVA', domandaTesto: 'TELEFONO INCLUSO VAR', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'DEVICE_1_FIN_SP_LT_200', targetLabel: '1° Device finanziato SP < 200€', conditions: { categoriaBiSuite: 'TIED IVA', domandaTesto: 'TELEFONO INCLUSO COMPASS', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'DEVICE_1_FIN_SP_LT_200', targetLabel: '1° Device finanziato SP < 200€', conditions: { categoriaBiSuite: 'TIED IVA', domandaTesto: 'TELEFONO INCLUSO FINDOMESTIC', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },

    { id: ruleId(), pista: 'mobile', targetCategory: 'MNP', targetLabel: 'MNP', conditions: { categoriaBiSuite: 'UNTIED', domandaTesto: 'MNP', rispostaDiversaDa: 'NO' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'MNP_MVNO', targetLabel: 'MNP da MVNO', conditions: { categoriaBiSuite: 'UNTIED', domandaTesto: 'MNP DA OPERATORI VIRTUALI', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'PIU_SICURI_MOBILE', targetLabel: 'Più Sicuri Mobile', conditions: { categoriaBiSuite: 'UNTIED', domandaTesto: 'PIU SICURI MOBILE', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'PIU_SICURI_MOBILE_PRO', targetLabel: 'Più Sicuri Mobile Pro', conditions: { categoriaBiSuite: 'UNTIED', domandaTesto: 'PIU SICURI MOBILE PRO', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'DEVICE_VAR_SP_LT_200', targetLabel: 'Device VAR < 200€', conditions: { categoriaBiSuite: 'UNTIED', domandaTesto: 'TELEFONO INCLUSO VAR', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'DEVICE_1_FIN_SP_LT_200', targetLabel: '1° Device finanziato SP < 200€', conditions: { categoriaBiSuite: 'UNTIED', domandaTesto: 'TELEFONO INCLUSO COMPASS', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'mobile', targetCategory: 'DEVICE_1_FIN_SP_LT_200', targetLabel: '1° Device finanziato SP < 200€', conditions: { categoriaBiSuite: 'UNTIED', domandaTesto: 'TELEFONO INCLUSO FINDOMESTIC', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },

    // ═══════════════ FISSO — BASE ═══════════════
    { id: ruleId(), pista: 'fisso', targetCategory: 'FISSO_FTTH', targetLabel: 'Fisso FTTH', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA CF', tipologiaBiSuite: 'FIBRA FTTH CF' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'fisso', targetCategory: 'FISSO_FTTC', targetLabel: 'Fisso FTTC', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA CF', tipologiaBiSuite: 'FIBRA FTTC CF' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'fisso', targetCategory: 'FISSO_FWA_OUT', targetLabel: 'FWA OUT', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA CF', tipologiaBiSuite: 'FWA CF', descrizioneBiSuite: 'OUTDOOR' }, priority: 15, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'fisso', targetCategory: 'FISSO_FWA_IND_2P', targetLabel: 'FWA IND 2P', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA CF', tipologiaBiSuite: 'FWA CF' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'fisso', targetCategory: 'BOLLETTINO_POSTALE', targetLabel: 'Bollettino Postale', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA CF', tipologiaBiSuite: 'VOUCHER / BOLLETTINO POSTALE' }, priority: 10, enabled: true, ruleType: 'base' },

    { id: ruleId(), pista: 'fisso', targetCategory: 'FISSO_PIVA_1A_LINEA', targetLabel: 'Fisso P.IVA 1ª Linea', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA IVA', tipologiaBiSuite: 'FIBRA FTTH IVA' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'fisso', targetCategory: 'FISSO_PIVA_1A_LINEA', targetLabel: 'Fisso P.IVA 1ª Linea', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA IVA', tipologiaBiSuite: 'FIBRA FTTC IVA' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'fisso', targetCategory: 'FISSO_PIVA_1A_LINEA', targetLabel: 'Fisso P.IVA 1ª Linea', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA IVA', tipologiaBiSuite: 'FWA IVA' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'fisso', targetCategory: 'FISSO_PIVA_2A_LINEA', targetLabel: 'Fisso P.IVA 2ª Linea', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA IVA', tipologiaBiSuite: 'VOUCHER / BOLLETTINO POSTALE', descrizioneBiSuite: '2' }, priority: 15, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'fisso', targetCategory: 'FISSO_PIVA_1A_LINEA', targetLabel: 'Fisso P.IVA 1ª Linea', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA IVA', tipologiaBiSuite: 'VOUCHER / BOLLETTINO POSTALE' }, priority: 10, enabled: true, ruleType: 'base' },

    { id: ruleId(), pista: 'fisso', targetCategory: 'FISSO_VOCE', targetLabel: 'Fisso Voce', conditions: { categoriaBiSuite: 'FISSO VOCE', tipologiaBiSuite: 'VOCE+' }, priority: 10, enabled: true, ruleType: 'base' },

    // ═══════════════ FISSO — ADDITIONAL ═══════════════
    { id: ruleId(), pista: 'fisso', targetCategory: 'CONVERGENZA', targetLabel: 'Convergenza', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA CF', domandaTesto: 'CONVERGENTE MOBILE', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'fisso', targetCategory: 'LINEA_ATTIVA', targetLabel: 'Linea Attiva', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA CF', domandaTesto: 'LINEA ATTIVA', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'fisso', targetCategory: 'NETFLIX_CON_ADV', targetLabel: 'Netflix con ADV', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA CF', domandaTesto: 'NETFLIX', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'fisso', targetCategory: 'PIU_SICURI_CASA_UFFICIO', targetLabel: 'Più Sicuri Casa/Ufficio', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA CF', domandaTesto: 'PIU SICURI CASA E UFFICIO', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },

    { id: ruleId(), pista: 'fisso', targetCategory: 'CONVERGENZA', targetLabel: 'Convergenza', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA IVA', domandaTesto: 'CONVERGENTE MOBILE', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'fisso', targetCategory: 'LINEA_ATTIVA', targetLabel: 'Linea Attiva', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA IVA', domandaTesto: 'LINEA ATTIVA', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'fisso', targetCategory: 'NETFLIX_CON_ADV', targetLabel: 'Netflix con ADV', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA IVA', domandaTesto: 'NETFLIX', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'fisso', targetCategory: 'PIU_SICURI_CASA_UFFICIO', targetLabel: 'Più Sicuri Casa/Ufficio', conditions: { categoriaBiSuite: 'ADSL/FIBRA/FWA IVA', domandaTesto: 'PIU SICURI CASA E UFFICIO', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },

    // ═══════════════ ENERGIA — BASE ═══════════════
    { id: ruleId(), pista: 'energia', targetCategory: 'CONSUMER_NO_SDD_W3', targetLabel: 'Consumer no SDD (ex W3)', conditions: { categoriaBiSuite: 'ENERGIA W3', clienteTipo: 'FISICA', domandaTesto: 'EX W3 ENERGIA BY ACEA', rispostaContiene: 'SI' }, priority: 15, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'energia', targetCategory: 'BUSINESS_NO_SDD_W3', targetLabel: 'Business no SDD (ex W3)', conditions: { categoriaBiSuite: 'ENERGIA W3', clienteTipo: 'PROFESSIONISTA', domandaTesto: 'EX W3 ENERGIA BY ACEA', rispostaContiene: 'SI' }, priority: 15, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'energia', targetCategory: 'BUSINESS_NO_SDD_W3', targetLabel: 'Business no SDD (ex W3)', conditions: { categoriaBiSuite: 'ENERGIA W3', clienteTipo: 'GIURIDICA', domandaTesto: 'EX W3 ENERGIA BY ACEA', rispostaContiene: 'SI' }, priority: 15, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'energia', targetCategory: 'CONSUMER_NO_SDD', targetLabel: 'Consumer no SDD', conditions: { categoriaBiSuite: 'ENERGIA W3', clienteTipo: 'FISICA' }, priority: 5, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'energia', targetCategory: 'BUSINESS_NO_SDD', targetLabel: 'Business no SDD', conditions: { categoriaBiSuite: 'ENERGIA W3', clienteTipo: 'PROFESSIONISTA' }, priority: 5, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'energia', targetCategory: 'BUSINESS_NO_SDD', targetLabel: 'Business no SDD', conditions: { categoriaBiSuite: 'ENERGIA W3', clienteTipo: 'GIURIDICA' }, priority: 5, enabled: true, ruleType: 'base' },

    // ═══════════════ ASSICURAZIONI — BASE ═══════════════
    { id: ruleId(), pista: 'assicurazioni', targetCategory: 'casaFamigliaStart', targetLabel: 'Casa Famiglia Start', conditions: { categoriaBiSuite: 'ASSICURAZIONI', tipologiaBiSuite: 'ASSICURAZIONI CASA' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'assicurazioni', targetCategory: 'viaggiVacanze', targetLabel: 'Viaggi Vacanze', conditions: { categoriaBiSuite: 'ASSICURAZIONI', tipologiaBiSuite: 'ASSICURAZIONI MOBILITY' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'assicurazioni', targetCategory: 'sportFamiglia', targetLabel: 'Sport Famiglia', conditions: { categoriaBiSuite: 'ASSICURAZIONI', tipologiaBiSuite: 'ASSICURAZIONI SPORT' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'assicurazioni', targetCategory: 'micioFido', targetLabel: 'Micio Fido', conditions: { categoriaBiSuite: 'ASSICURAZIONI', tipologiaBiSuite: 'ASSICURAZIONI PET' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'assicurazioni', targetCategory: 'protezionePro', targetLabel: 'Protezione Pro', conditions: { categoriaBiSuite: 'ASSICURAZIONI BUSINESS PRO' }, priority: 10, enabled: true, ruleType: 'base' },

    // ═══════════════ ASSICURAZIONI — ADDITIONAL ═══════════════
    { id: ruleId(), pista: 'assicurazioni', targetCategory: 'viaggioMondo', targetLabel: 'Viaggio Mondo', conditions: { categoriaBiSuite: 'ASSICURAZIONI', domandaTesto: 'ASSICURAZIONE VIAGGIO MONDO', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },

    // ═══════════════ PROTECTA — BASE ═══════════════
    { id: ruleId(), pista: 'protecta', targetCategory: 'casaStart', targetLabel: 'Casa Start', conditions: { categoriaBiSuite: 'ALLARMI', tipologiaBiSuite: 'ALLARMI PROTECTA' }, priority: 10, enabled: true, ruleType: 'base' },

    // ═══════════════ PARTNERSHIP / CB — BASE ═══════════════
    { id: ruleId(), pista: 'partnership', targetCategory: 'cambio_offerta_rivincoli', targetLabel: 'Cambio Offerta Rivincoli', conditions: { categoriaBiSuite: 'MIA TIED', tipologiaBiSuite: 'MIA EASYPAY STANDARD' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'cambio_offerta_rivincoli', targetLabel: 'Cambio Offerta Rivincoli', conditions: { categoriaBiSuite: 'MIA TIED', tipologiaBiSuite: 'MIA EASYPAY CYC' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'cambio_offerta_rivincoli', targetLabel: 'Cambio Offerta Rivincoli', conditions: { categoriaBiSuite: 'MIA TIED', tipologiaBiSuite: 'COUPON CARING TIED' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'cambio_offerta_untied', targetLabel: 'Cambio Offerta Untied', conditions: { categoriaBiSuite: 'MIA UNTIED', tipologiaBiSuite: 'MIA UNTIED STANDARD' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'cambio_offerta_untied', targetLabel: 'Cambio Offerta Untied', conditions: { categoriaBiSuite: 'MIA UNTIED', tipologiaBiSuite: 'MIA UNTIED CYC' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'cambio_offerta_untied', targetLabel: 'Cambio Offerta Untied', conditions: { categoriaBiSuite: 'MIA UNTIED', tipologiaBiSuite: 'COUPON CARING UNTIED' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'cambio_offerta_rivincoli', targetLabel: 'Cambio Offerta Rivincoli', conditions: { categoriaBiSuite: 'RIVINCOLO', tipologiaBiSuite: 'RIVINCOLO VOCE' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'cambio_offerta_rivincoli', targetLabel: 'Cambio Offerta Rivincoli', conditions: { categoriaBiSuite: 'RIVINCOLO', tipologiaBiSuite: 'RIVINCOLI IVA' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'cambio_offerta_rivincoli', targetLabel: 'Cambio Offerta Rivincoli', conditions: { categoriaBiSuite: 'RIVINCOLO', tipologiaBiSuite: 'RIVINCOLO DATI' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'cambio_offerta_untied', targetLabel: 'Cambio Offerta Untied', conditions: { categoriaBiSuite: 'ALTRI EVENTI CB', tipologiaBiSuite: 'ALTRI CAMBI OFFERTA CB' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'MIGRAZIONI_FTTH_FWA', targetLabel: 'Migrazioni FTTH/FWA', conditions: { categoriaBiSuite: 'ALTRI EVENTI CB', tipologiaBiSuite: 'MIGRAZIONI' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'addon_ricorrenti_mensile_high', targetLabel: 'Add On ≥ 9.99€', conditions: { categoriaBiSuite: 'ADD-ON CB', tipologiaBiSuite: 'ADD-ON CON CANONE MENSILE', canoneMinimo: 9.99 }, priority: 15, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'addon_ricorrenti_mensile_low', targetLabel: 'Add On ≤ 9.99€', conditions: { categoriaBiSuite: 'ADD-ON CB', tipologiaBiSuite: 'ADD-ON CON CANONE MENSILE' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'addon_one_off', targetLabel: 'Add On One Off', conditions: { categoriaBiSuite: 'ADD-ON CB', tipologiaBiSuite: 'ADD-ON SENZA CANONE MENSILE' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'opzione_piu_sicuri_pro', targetLabel: 'WindTre Security Pro', conditions: { categoriaBiSuite: 'WINDTRE SECURITY PRO CB', tipologiaBiSuite: 'WINDTRE SECURITY PRO CB' }, priority: 10, enabled: true, ruleType: 'base' },

    // ═══════════════ PARTNERSHIP / CB — ADDITIONAL ═══════════════
    { id: ruleId(), pista: 'partnership', targetCategory: 'opzione_piu_sicuri', targetLabel: 'Più Sicuri Mobile', conditions: { categoriaBiSuite: 'MIA TIED', domandaTesto: 'PIU SICURI MOBILE CB', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'opzione_piu_sicuri_pro', targetLabel: 'Più Sicuri Mobile Pro', conditions: { categoriaBiSuite: 'MIA TIED', domandaTesto: 'PIU SICURI MOBILE PRO CB', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'opzione_piu_sicuri', targetLabel: 'Più Sicuri Mobile', conditions: { categoriaBiSuite: 'MIA UNTIED', domandaTesto: 'PIU SICURI MOBILE CB', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'opzione_piu_sicuri_pro', targetLabel: 'Più Sicuri Mobile Pro', conditions: { categoriaBiSuite: 'MIA UNTIED', domandaTesto: 'PIU SICURI MOBILE PRO CB', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'IMP_AGG_0_VAR_FINANZ', targetLabel: 'IMP.AGG=0 VAR/FINANZ', conditions: { categoriaBiSuite: 'MIA TIED', domandaTesto: 'MIA TELEFONO FINANZIAMENTO', rispostaNumericaUguale: 0 }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'IMP_AGG_GT0_FINANZ', targetLabel: 'IMP.AGG>0 FINANZ', conditions: { categoriaBiSuite: 'MIA TIED', domandaTesto: 'MIA TELEFONO FINANZIAMENTO', rispostaNumericaMaggiore: 0 }, priority: 18, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'IMP_AGG_0_VAR_FINANZ', targetLabel: 'IMP.AGG=0 VAR/FINANZ', conditions: { categoriaBiSuite: 'MIA TIED', domandaTesto: 'MIA TELEFONO VAR', rispostaNumericaUguale: 0 }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'IMP_AGG_GT0_VAR', targetLabel: 'IMP.AGG>0 VAR', conditions: { categoriaBiSuite: 'MIA TIED', domandaTesto: 'MIA TELEFONO VAR', rispostaNumericaMaggiore: 0 }, priority: 18, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'IMP_AGG_0_VAR_FINANZ', targetLabel: 'IMP.AGG=0 VAR/FINANZ', conditions: { categoriaBiSuite: 'MIA UNTIED', domandaTesto: 'MIA TELEFONO FINANZIAMENTO', rispostaNumericaUguale: 0 }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'IMP_AGG_GT0_FINANZ', targetLabel: 'IMP.AGG>0 FINANZ', conditions: { categoriaBiSuite: 'MIA UNTIED', domandaTesto: 'MIA TELEFONO FINANZIAMENTO', rispostaNumericaMaggiore: 0 }, priority: 18, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'IMP_AGG_0_VAR_FINANZ', targetLabel: 'IMP.AGG=0 VAR/FINANZ', conditions: { categoriaBiSuite: 'MIA UNTIED', domandaTesto: 'MIA TELEFONO VAR', rispostaNumericaUguale: 0 }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'IMP_AGG_GT0_VAR', targetLabel: 'IMP.AGG>0 VAR', conditions: { categoriaBiSuite: 'MIA UNTIED', domandaTesto: 'MIA TELEFONO VAR', rispostaNumericaMaggiore: 0 }, priority: 18, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'multi_device_finanziamento', targetLabel: 'Multi Device Finanziamento', conditions: { categoriaBiSuite: 'MIA TIED', domandaTesto: 'TELEFONO INCLUSO MULTI FINANZIAMENTO', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
    { id: ruleId(), pista: 'partnership', targetCategory: 'multi_device_finanziamento', targetLabel: 'Multi Device Finanziamento', conditions: { categoriaBiSuite: 'MIA UNTIED', domandaTesto: 'TELEFONO INCLUSO MULTI FINANZIAMENTO', rispostaContiene: 'SI' }, priority: 20, enabled: true, ruleType: 'additional' },
  ];
}

export interface BiSuiteArticolo {
  categoria?: { nome?: string };
  tipologia?: { nome?: string };
  descrizione?: string;
  tipo?: string;
  dettaglio?: {
    domandeRisposte?: Array<{
      domandaTesto?: string;
      risposta?: string;
    }>;
    canone?: string;
    importo?: string;
    prezzo?: string;
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
  ruleType: 'base' | 'additional';
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

  if (condition.descrizioneBiSuite) {
    const descNome = (articolo.descrizione || '').toUpperCase().trim();
    const condDesc = condition.descrizioneBiSuite.toUpperCase().trim();
    if (!descNome.includes(condDesc)) return false;
  }

  if (condition.descrizioneEscludi) {
    const descNome = (articolo.descrizione || '').toUpperCase().trim();
    const esclusioni = condition.descrizioneEscludi.split(',').map(s => s.toUpperCase().trim()).filter(Boolean);
    for (const escl of esclusioni) {
      if (descNome.includes(escl)) return false;
    }
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

  if (condition.domandaTesto && condition.rispostaDiversaDa && !condition.rispostaContiene) {
    const domandeRisposte = articolo.dettaglio?.domandeRisposte || [];
    const domandaTarget = condition.domandaTesto.toUpperCase().trim();
    const rispostaEscludi = condition.rispostaDiversaDa.toUpperCase().trim();
    const entry = domandeRisposte.find(
      (dr) => (dr.domandaTesto || '').toUpperCase().trim().includes(domandaTarget)
    );
    if (!entry) return false;
    const risposta = (entry.risposta || '').toUpperCase().trim();
    if (risposta.includes(rispostaEscludi) || risposta === '') return false;
  }

  if (condition.canoneMinimo !== undefined) {
    const canone = parseFloat(articolo.dettaglio?.canone || '0') || 0;
    if (canone < condition.canoneMinimo) return false;
  }

  if (condition.domandaTesto && condition.rispostaEsatta) {
    const domandeRisposte = articolo.dettaglio?.domandeRisposte || [];
    const domandaTarget = condition.domandaTesto.toUpperCase().trim();
    const rispostaTarget = condition.rispostaEsatta.toUpperCase().trim();
    const found = domandeRisposte.some(
      (dr) =>
        (dr.domandaTesto || '').toUpperCase().trim().includes(domandaTarget) &&
        (dr.risposta || '').toUpperCase().trim() === rispostaTarget
    );
    if (!found) return false;
  }

  if (condition.domandaTesto && condition.rispostaNumericaUguale !== undefined) {
    const domandeRisposte = articolo.dettaglio?.domandeRisposte || [];
    const domandaTarget = condition.domandaTesto.toUpperCase().trim();
    const entry = domandeRisposte.find(
      (dr) => (dr.domandaTesto || '').toUpperCase().trim().includes(domandaTarget)
    );
    if (!entry) return false;
    const val = parseFloat((entry.risposta || '').replace(',', '.')) || 0;
    if (val !== condition.rispostaNumericaUguale) return false;
  }

  if (condition.domandaTesto && condition.rispostaNumericaMaggiore !== undefined) {
    const domandeRisposte = articolo.dettaglio?.domandeRisposte || [];
    const domandaTarget = condition.domandaTesto.toUpperCase().trim();
    const entry = domandeRisposte.find(
      (dr) => (dr.domandaTesto || '').toUpperCase().trim().includes(domandaTarget)
    );
    if (!entry) return false;
    const val = parseFloat((entry.risposta || '').replace(',', '.')) || 0;
    if (val <= condition.rispostaNumericaMaggiore) return false;
  }

  return true;
}

function isBaseRule(rule: BiSuiteMappingRule): boolean {
  if (rule.ruleType) return rule.ruleType === 'base';
  const c = rule.conditions;
  return !c.domandaTesto;
}

export function mapBiSuiteArticle(
  articolo: BiSuiteArticolo,
  clienteTipo: string,
  rules: BiSuiteMappingRule[]
): MappedArticle[] {
  const enabledRules = rules.filter((r) => r.enabled);
  
  const baseRules = enabledRules
    .filter((r) => isBaseRule(r))
    .sort((a, b) => b.priority - a.priority);
  const additionalRules = enabledRules
    .filter((r) => !isBaseRule(r))
    .sort((a, b) => b.priority - a.priority);

  const results: MappedArticle[] = [];
  const addedCategories = new Set<string>();

  for (const rule of baseRules) {
    if (matchesCondition(rule.conditions, articolo, clienteTipo)) {
      const key = `${rule.pista}:${rule.targetCategory}`;
      if (!addedCategories.has(key)) {
        addedCategories.add(key);
        results.push({
          pista: rule.pista,
          targetCategory: rule.targetCategory,
          targetLabel: rule.targetLabel,
          ruleId: rule.id,
          ruleType: 'base',
        });
      }
      break;
    }
  }

  for (const rule of additionalRules) {
    if (matchesCondition(rule.conditions, articolo, clienteTipo)) {
      const key = `${rule.pista}:${rule.targetCategory}`;
      if (!addedCategories.has(key)) {
        addedCategories.add(key);
        results.push({
          pista: rule.pista,
          targetCategory: rule.targetCategory,
          targetLabel: rule.targetLabel,
          ruleId: rule.id,
          ruleType: 'additional',
        });
      }
    }
  }

  return results;
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
    results.push(...mapped);
  }

  return results;
}
