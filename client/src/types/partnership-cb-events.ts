// Tipi di eventi Customer Base per Partnership Reward

export type CBEventType = 
  // Customer Base Eventi
  | 'cambio_offerta_untied'
  | 'cambio_offerta_rivincoli'
  | 'cambio_offerta_smart_pack'
  | 'telefono_incluso_var'
  | 'telefono_incluso_smart_pack_compass_findomestic'
  | 'multi_device_standard'
  | 'multi_device_finanziamento'
  | 'addon_ricorrenti_mensile_low'
  | 'addon_ricorrenti_mensile_high'
  | 'addon_one_off'
  | 'addon_unlimited_giga'
  | 'opzione_piu_sicuri_pro'
  | 'opzione_piu_sicuri'
  | 'reload_exchange'
  | 'gestione_cambia_telefono'
  | 'windtre_goplay'
  | 'buy_tied'
  | 'buy_untied'
  | 'IMP_AGG_0_VAR_FINANZ'
  | 'IMP_AGG_GT0_FINANZ'
  | 'IMP_AGG_GT0_VAR'
  | 'MIGRAZIONI_FTTH_FWA'
  // Altri eventi flat - Fisso
  | 'migrazione_ftth'
  | 'migrazione_ftth_extra'
  | 'migrazione_fwa_indoor_outdoor'
  | 'migrazione_super_fibra_professional'
  | 'migrazione_fttc'
  | 'migrazione_casa_professional'
  | 'offerta_superfibra_netflix_no_adv'
  | 'offerta_superfibra_netflix_adv'
  | 'piu_sicuri_casa_ufficio'
  | 'cambio_piano_fisso'
  // Altri eventi flat - Mobile
  | 'cambio_offerta_microbusiness'
  | 'sostituzione_sim_3g'
  | 'roaming_itz_piva'
  | 'pagamento_fatture_pinpad';

export interface CBEventConfig {
  type: CBEventType;
  label: string;
  category: 'customer_base' | 'fisso_flat' | 'mobile_flat';
  clusterCard?: string; // Es: C0U, C1U, TI, SP, etc.
  gettoni: number;
  description?: string;
}

export const CB_EVENTS_CONFIG: CBEventConfig[] = [
  // CUSTOMER BASE EVENTI
  { type: 'cambio_offerta_untied', label: 'Cambio Offerta MIA UNTIED / MIA CYC UNTIED', category: 'customer_base', clusterCard: 'varies', gettoni: 0, description: 'C0U: 3€, C1U: 8€, C2U: 16€, C3U: 26€' },
  { type: 'cambio_offerta_rivincoli', label: 'Cambio Offerta Rivincoli Easy Pay / CYC Easy Pay', category: 'customer_base', clusterCard: 'varies', gettoni: 0, description: 'C0T: 4€, C1T: 12€, C2T: 21€, C3T: 31€' },
  { type: 'cambio_offerta_smart_pack', label: 'Cambio Offerta MIA Smart Pack con OTP', category: 'customer_base', clusterCard: 'SP', gettoni: 12 },
  { type: 'telefono_incluso_var', label: 'Telefono Incluso Offerta MIA Smart Pack', category: 'customer_base', clusterCard: 'TI', gettoni: 0, description: 'IMP.AGG = 0 VAR e FINANZ: 10€, IMP.AGG > 0 VAR: 15€, COMPASS e FINDOMESTIC: 20€' },
  { type: 'telefono_incluso_smart_pack_compass_findomestic', label: 'Telefono Incluso Smart Pack Compass/Findomestic', category: 'customer_base', clusterCard: 'TI', gettoni: 20 },
  { type: 'multi_device_standard', label: 'Multi Device Standard', category: 'customer_base', clusterCard: 'TI', gettoni: 15 },
  { type: 'multi_device_finanziamento', label: 'Multi Device Finanziamento', category: 'customer_base', clusterCard: 'TI', gettoni: 15 },
  { type: 'addon_ricorrenti_mensile_low', label: 'Add On Ricorrenti Mensile ≤ 9.99€', category: 'customer_base', clusterCard: 'AD1', gettoni: 3 },
  { type: 'addon_ricorrenti_mensile_high', label: 'Add On Ricorrenti Mensile ≥ 9.99€', category: 'customer_base', clusterCard: 'AD2', gettoni: 5 },
  { type: 'addon_one_off', label: 'Add On One Off a Pagamento', category: 'customer_base', clusterCard: 'AD', gettoni: 3 },
  { type: 'addon_unlimited_giga', label: 'Add On Unlimited Giga Boom con Giga illimitati 3 mesi', category: 'customer_base', clusterCard: 'UGB', gettoni: 5 },
  { type: 'opzione_piu_sicuri_pro', label: "Opzione Più Sicuri Mobile Pro", category: 'customer_base', clusterCard: 'PSP', gettoni: 5 },
  { type: 'opzione_piu_sicuri', label: "Opzione Più Sicuri Mobile", category: 'customer_base', clusterCard: 'PS', gettoni: 0.5 },
  { type: 'reload_exchange', label: 'Reload Exchange', category: 'customer_base', clusterCard: 'REX', gettoni: 5 },
  { type: 'gestione_cambia_telefono', label: 'Gestione Cambia Telefono con Reload Plus', category: 'customer_base', clusterCard: 'CRP', gettoni: 17 },
  { type: 'windtre_goplay', label: 'WindTre GoPlay', category: 'customer_base', clusterCard: 'GOP', gettoni: 3 },
  { type: 'buy_tied', label: 'MIA Unlimited Primo Mese Gratis BUY TIED con OTP', category: 'customer_base', clusterCard: 'BUT', gettoni: 12 },
  { type: 'buy_untied', label: 'MIA Unlimited Primo Mese Gratis BUY UNTIED', category: 'customer_base', clusterCard: 'BUU', gettoni: 8 },
  
  // ALTRI EVENTI FLAT - FISSO
  { type: 'migrazione_ftth', label: 'Migrazioni verso Fibra FTTH', category: 'fisso_flat', gettoni: 40 },
  { type: 'migrazione_ftth_extra', label: 'Migrazioni verso Fibra FTTH EXTRA', category: 'fisso_flat', gettoni: 40 },
  { type: 'migrazione_fwa_indoor_outdoor', label: 'Migrazioni verso FWA Indoor 2P/Outdoor 1ª Casa', category: 'fisso_flat', gettoni: 40 },
  { type: 'migrazione_super_fibra_professional', label: 'Migrazioni Super Fibra Professional Box con modem FRITZ!Box', category: 'fisso_flat', gettoni: 80 },
  { type: 'migrazione_fttc', label: 'Migrazioni verso Fibra FTTC', category: 'fisso_flat', gettoni: 10 },
  { type: 'migrazione_casa_professional', label: 'Migrazioni verso Casa/Professional', category: 'fisso_flat', gettoni: 10 },
  { type: 'offerta_superfibra_netflix_no_adv', label: 'Offerta Superfibra & Netflix senza ADV', category: 'fisso_flat', gettoni: 10 },
  { type: 'offerta_superfibra_netflix_adv', label: 'Offerta Superfibra & Netflix con ADV', category: 'fisso_flat', gettoni: 5 },
  { type: 'piu_sicuri_casa_ufficio', label: "Più Sicuri Casa & Ufficio", category: 'fisso_flat', gettoni: 5 },
  { type: 'cambio_piano_fisso', label: 'Cambio Piano Fisso su Customer Base Profilata', category: 'fisso_flat', gettoni: 10 },
  
  // ALTRI EVENTI FLAT - MOBILE
  { type: 'cambio_offerta_microbusiness', label: 'Cambio Offerta Microbusiness con OTP', category: 'mobile_flat', gettoni: 20 },
  { type: 'sostituzione_sim_3g', label: 'Sostituzione SIM 3G', category: 'mobile_flat', gettoni: 5 },
  { type: 'roaming_itz_piva', label: 'Roaming ITZ P.IVA - Opzioni Monthly', category: 'mobile_flat', gettoni: 5 },
  { type: 'pagamento_fatture_pinpad', label: 'Pagamento Fatture tramite Pinpad', category: 'mobile_flat', gettoni: 0.5 },
  { type: 'IMP_AGG_0_VAR_FINANZ', label: 'IMP.AGG=0 VAR/FINANZ', category: 'customer_base', clusterCard: 'TI', gettoni: 10 },
  { type: 'IMP_AGG_GT0_FINANZ', label: 'IMP.AGG>0 FINANZ', category: 'customer_base', clusterCard: 'TI', gettoni: 20 },
  { type: 'IMP_AGG_GT0_VAR', label: 'IMP.AGG>0 VAR', category: 'customer_base', clusterCard: 'TI', gettoni: 15 },
  { type: 'MIGRAZIONI_FTTH_FWA', label: 'Migrazioni FTTH/FWA', category: 'customer_base', gettoni: 40 },
];

// Configurazione cluster per cambi offerta untied
export const CAMBIO_OFFERTA_UNTIED_CLUSTERS = [
  { cluster: 'C0U', gettoni: 3, puntiPartnership: 2 },
  { cluster: 'C1U', gettoni: 8, puntiPartnership: 2 },
  { cluster: 'C2U', gettoni: 16, puntiPartnership: 2 },
  { cluster: 'C3U', gettoni: 26, puntiPartnership: 2 },
];

// Configurazione cluster per cambi offerta rivincoli
export const CAMBIO_OFFERTA_RIVINCOLI_CLUSTERS = [
  { cluster: 'C0T', gettoni: 4, puntiPartnership: 4 },
  { cluster: 'C1T', gettoni: 12, puntiPartnership: 4 },
  { cluster: 'C2T', gettoni: 21, puntiPartnership: 4 },
  { cluster: 'C3T', gettoni: 31, puntiPartnership: 4 },
];

// Configurazione per telefono incluso
export const TELEFONO_INCLUSO_OPTIONS = [
  { option: 'IMP_AGG_0_VAR_FINANZ', label: 'IMP.AGG = 0 VAR e FINANZ', gettoni: 10, puntiPartnership: 6 },
  { option: 'IMP_AGG_GT_0_VAR', label: 'IMP.AGG > 0 VAR', gettoni: 15, puntiPartnership: 6 },
  { option: 'COMPASS_FINDOMESTIC', label: 'COMPASS e FINDOMESTIC', gettoni: 20, puntiPartnership: 8 },
];

export interface AttivatoCBDettaglio {
  eventType: CBEventType;
  pezzi: number;
  gettoni: number;
  puntiPartnership: number; // Punti per il calcolo del target e premio
  clusterCard?: string; // Per eventi con variazioni cluster
  note?: string;
}

export interface PartnershipDefaultEntry {
  gettoni: number;
  puntiPartnership: number;
  label: string;
  clusterDependent?: boolean;
}

export const PARTNERSHIP_DEFAULTS: Record<string, PartnershipDefaultEntry> = {};

const UNTIED_CLUSTER_MAP: Record<string, number> = {};
CAMBIO_OFFERTA_UNTIED_CLUSTERS.forEach(c => { UNTIED_CLUSTER_MAP[c.cluster] = c.gettoni; });

const RIVINCOLI_CLUSTER_MAP: Record<string, number> = {};
CAMBIO_OFFERTA_RIVINCOLI_CLUSTERS.forEach(c => { RIVINCOLI_CLUSTER_MAP[c.cluster] = c.gettoni; });

const TI_OPTION_MAP: Record<string, { gettoni: number; puntiPartnership: number }> = {};
TELEFONO_INCLUSO_OPTIONS.forEach(o => { TI_OPTION_MAP[o.option] = { gettoni: o.gettoni, puntiPartnership: o.puntiPartnership }; });

CB_EVENTS_CONFIG.forEach(e => {
  if (!PARTNERSHIP_DEFAULTS[e.type]) {
    PARTNERSHIP_DEFAULTS[e.type] = { gettoni: e.gettoni, puntiPartnership: 1, label: e.label };
  }
});

PARTNERSHIP_DEFAULTS['cambio_offerta_untied'] = { gettoni: 3, puntiPartnership: 2, label: 'Cambio Offerta UNTIED', clusterDependent: true };
PARTNERSHIP_DEFAULTS['cambio_offerta_rivincoli'] = { gettoni: 4, puntiPartnership: 4, label: 'Cambio Offerta Rivincoli', clusterDependent: true };
PARTNERSHIP_DEFAULTS['cambio_offerta_smart_pack'] = { gettoni: 12, puntiPartnership: 2, label: 'Cambio Offerta Smart Pack con OTP' };
PARTNERSHIP_DEFAULTS['telefono_incluso_var'] = { gettoni: 10, puntiPartnership: 6, label: 'Telefono Incluso VAR' };
PARTNERSHIP_DEFAULTS['telefono_incluso_smart_pack_compass_findomestic'] = { gettoni: 20, puntiPartnership: 8, label: 'Telefono Incluso Compass/Findomestic' };
PARTNERSHIP_DEFAULTS['multi_device_standard'] = { gettoni: 15, puntiPartnership: 6, label: 'Multi Device Standard' };
PARTNERSHIP_DEFAULTS['multi_device_finanziamento'] = { gettoni: 15, puntiPartnership: 6, label: 'Multi Device Finanziamento' };
PARTNERSHIP_DEFAULTS['addon_ricorrenti_mensile_low'] = { gettoni: 3, puntiPartnership: 1, label: 'Add On Ricorrenti ≤ 9.99€' };
PARTNERSHIP_DEFAULTS['addon_ricorrenti_mensile_high'] = { gettoni: 5, puntiPartnership: 1, label: 'Add On Ricorrenti ≥ 9.99€' };
PARTNERSHIP_DEFAULTS['addon_one_off'] = { gettoni: 3, puntiPartnership: 1, label: 'Add On One Off' };
PARTNERSHIP_DEFAULTS['addon_unlimited_giga'] = { gettoni: 5, puntiPartnership: 1, label: 'Add On Unlimited Giga Boom' };
PARTNERSHIP_DEFAULTS['opzione_piu_sicuri_pro'] = { gettoni: 5, puntiPartnership: 1, label: 'Più Sicuri Mobile Pro' };
PARTNERSHIP_DEFAULTS['opzione_piu_sicuri'] = { gettoni: 0.5, puntiPartnership: 1, label: 'Più Sicuri Mobile' };
PARTNERSHIP_DEFAULTS['reload_exchange'] = { gettoni: 5, puntiPartnership: 1, label: 'Reload Exchange' };
PARTNERSHIP_DEFAULTS['gestione_cambia_telefono'] = { gettoni: 17, puntiPartnership: 1, label: 'Gestione Cambia Telefono con Reload Plus' };
PARTNERSHIP_DEFAULTS['windtre_goplay'] = { gettoni: 3, puntiPartnership: 1, label: 'WindTre GoPlay' };
PARTNERSHIP_DEFAULTS['buy_tied'] = { gettoni: 12, puntiPartnership: 2, label: 'BUY TIED con OTP' };
PARTNERSHIP_DEFAULTS['buy_untied'] = { gettoni: 8, puntiPartnership: 2, label: 'BUY UNTIED' };
PARTNERSHIP_DEFAULTS['IMP_AGG_0_VAR_FINANZ'] = { gettoni: 10, puntiPartnership: 6, label: 'IMP.AGG=0 VAR/FINANZ' };
PARTNERSHIP_DEFAULTS['IMP_AGG_GT0_FINANZ'] = { gettoni: 20, puntiPartnership: 8, label: 'IMP.AGG>0 FINANZ (Compass/Findomestic)' };
PARTNERSHIP_DEFAULTS['IMP_AGG_GT0_VAR'] = { gettoni: 15, puntiPartnership: 6, label: 'IMP.AGG>0 VAR' };
PARTNERSHIP_DEFAULTS['MIGRAZIONI_FTTH_FWA'] = { gettoni: 40, puntiPartnership: 1, label: 'Migrazioni FTTH/FWA' };

export function resolveClusterGettoni(eventType: string, clusterCard?: string): number | undefined {
  if (eventType === 'cambio_offerta_untied' && clusterCard) {
    return UNTIED_CLUSTER_MAP[clusterCard];
  }
  if (eventType === 'cambio_offerta_rivincoli' && clusterCard) {
    return RIVINCOLI_CLUSTER_MAP[clusterCard];
  }
  return undefined;
}

export { UNTIED_CLUSTER_MAP, RIVINCOLI_CLUSTER_MAP, TI_OPTION_MAP };

export interface CalcoloPartnershipRewardResult {
  punti: number;
  totaleGettoni: number;
  totalePezzi: number;
  percentualeTarget: number;
  targetRaggiunto: '100%' | '80%' | 'nessuno';
  premioMaturato: number;
  runRateGiornalieroPezzi: number;
  giorniLavorativi: number;
  
  dettaglioEventi: {
    eventType: CBEventType;
    pezzi: number;
    gettoniUnitari: number;
    puntiPartnershipUnitari: number;
    gettoniTotali: number;
    puntiPartnership: number;
  }[];
}
