// -----------------------------------------------------------------------------
// Tipi di base condivisi (puoi allinearli con quelli che hai per il Mobile)
// -----------------------------------------------------------------------------

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = domenica

export interface WeeklySchedule {
  workingDays: Weekday[]; // es. [1,2,3,4,5] = lun–ven
}

export interface SpecialDay {
  date: string; // YYYY-MM-DD
  isOpen: boolean;
  note?: string;
}

export interface StoreCalendar {
  weeklySchedule: WeeklySchedule;
  specialDays?: SpecialDay[];
}

/**
 * Config pista FISSO per singolo POS
 * (analogo a PistaMobilePosConfig che avevamo già)
 */
export interface PistaFissoPosConfig {
  posCode: string;
  soglia1: number;
  soglia2: number;
  soglia3: number;
  soglia4: number;
  soglia5: number;
  multiplierSoglia1: number;
  multiplierSoglia2: number;
  multiplierSoglia3: number;
  multiplierSoglia4: number;
  multiplierSoglia5: number;
  forecastTargetPunti?: number;
}

/**
 * Categorie FISSO – i codici servono per legare
 * le righe di "volumi" del form manuale ai parametri economici.
 */
export type FissoCategoriaType =
  | "FISSO_FTTC"
  | "FISSO_FTTH"
  | "FISSO_FWA_OUT"
  | "FISSO_FWA_IND_2P"
  | "FRITZ_BOX"
  | "NETFLIX_CON_ADV"
  | "NETFLIX_SENZA_ADV"
  | "CONVERGENZA"
  | "LINEA_ATTIVA"
  | "FISSO_PIVA_1A_LINEA"
  | "FISSO_PIVA_2A_LINEA"
  | "CHIAMATE_ILLIMITATE"
  | "BOLLETTINO_POSTALE"
  | "PIU_SICURI_CASA_UFFICIO"
  | "ASSICURAZIONI_PLUS_FULL"
  | "MIGRAZIONI_FTTH_FWA";

// Gettone contrattuale Fisso: 23€ per tutti, 10€ per 2ª linea P.IVA
const GETTONE_CONTRATTUALE_FISSO: Record<FissoCategoriaType, number> = {
  FISSO_FTTC: 23,
  FISSO_FTTH: 23,
  FISSO_FWA_OUT: 23,
  FISSO_FWA_IND_2P: 23,
  FRITZ_BOX: 0,
  NETFLIX_CON_ADV: 0,
  NETFLIX_SENZA_ADV: 0,
  CONVERGENZA: 23,
  LINEA_ATTIVA: 23,
  FISSO_PIVA_1A_LINEA: 23,
  FISSO_PIVA_2A_LINEA: 10,
  CHIAMATE_ILLIMITATE: 0,
  BOLLETTINO_POSTALE: 0,
  PIU_SICURI_CASA_UFFICIO: 0,
  ASSICURAZIONI_PLUS_FULL: 0,
  MIGRAZIONI_FTTH_FWA: 0, // Le migrazioni non hanno gettone contrattuale, hanno gettone fisso 40€
};

/**
 * Parametri "di gara" per ogni categoria FISSO
 * (punti, euro/pezzo, extra cluster 3).
 * I numeri qui sotto sono presi dalla tabella che mi hai mandato.
 */
export interface FissoCategoriaConfig {
  type: FissoCategoriaType;
  label: string;
  puntiPerPezzo: number;
  euroPerPezzo: number;
  extraCluster3Euro: number;
}

export const FISSO_CATEGORIE_DEFAULT: FissoCategoriaConfig[] = [
  {
    type: "FISSO_FTTC",
    label: "Fisso FTTC",
    puntiPerPezzo: 1,
    euroPerPezzo: 0,
    extraCluster3Euro: 0,
  },
  {
    type: "FISSO_FTTH",
    label: "Fisso FTTH",
    puntiPerPezzo: 1,
    euroPerPezzo: 22,
    extraCluster3Euro: 0,
  },
  {
    type: "FISSO_FWA_OUT",
    label: "Fisso FWA OUT",
    puntiPerPezzo: 1,
    euroPerPezzo: 33,
    extraCluster3Euro: 0,
  },
  {
    type: "FISSO_FWA_IND_2P",
    label: "Fisso FWA IND 2P",
    puntiPerPezzo: 1,
    euroPerPezzo: 33,
    extraCluster3Euro: 0,
  },
  {
    type: "NETFLIX_CON_ADV",
    label: "Netflix con ADV",
    puntiPerPezzo: 0.5,
    euroPerPezzo: 5,
    extraCluster3Euro: 0,
  },
  {
    type: "NETFLIX_SENZA_ADV",
    label: "Netflix senza ADV",
    puntiPerPezzo: 0.5,
    euroPerPezzo: 10,
    extraCluster3Euro: 0,
  },
  {
    type: "CONVERGENZA",
    label: "Convergenza",
    puntiPerPezzo: 0,
    euroPerPezzo: 44,
    extraCluster3Euro: 0,
  },
  {
    type: "LINEA_ATTIVA",
    label: "Linea Attiva",
    puntiPerPezzo: 0,
    euroPerPezzo: 22,
    extraCluster3Euro: 0,
  },
  // --- di cui P.IVA ---
  {
    type: "FISSO_PIVA_1A_LINEA",
    label: "Fisso P.IVA 1ª Linea",
    puntiPerPezzo: 0.5,
    euroPerPezzo: 22,
    extraCluster3Euro: 0,
  },
  {
    type: "FISSO_PIVA_2A_LINEA",
    label: "Fisso P.IVA 2ª Linea",
    puntiPerPezzo: 0.5,
    euroPerPezzo: 10,
    extraCluster3Euro: 0,
  },
  {
    type: "FRITZ_BOX",
    label: "Fritz BOX",
    puntiPerPezzo: 1,
    euroPerPezzo: 40,
    extraCluster3Euro: 0,
  },
  // --- fine di cui P.IVA ---
  {
    type: "CHIAMATE_ILLIMITATE",
    label: "Chiamate illimitate",
    puntiPerPezzo: 0,
    euroPerPezzo: 22,
    extraCluster3Euro: 0,
  },
  {
    type: "BOLLETTINO_POSTALE",
    label: "Bollettino postale (no 2ª casa)",
    puntiPerPezzo: 0,
    euroPerPezzo: 48,
    extraCluster3Euro: 0,
  },
  {
    type: "PIU_SICURI_CASA_UFFICIO",
    label: "Più sicuri Casa e Ufficio",
    puntiPerPezzo: 0.25,
    euroPerPezzo: 2,
    extraCluster3Euro: 80,
  },
  {
    type: "ASSICURAZIONI_PLUS_FULL",
    label: "Assicurazioni Plus o Full",
    puntiPerPezzo: 0.5,
    euroPerPezzo: 0,
    extraCluster3Euro: 0,
  },
  {
    type: "MIGRAZIONI_FTTH_FWA",
    label: "Migrazioni vs FTTH Extra e FWA Outdoor",
    puntiPerPezzo: 0,
    euroPerPezzo: 40,
    extraCluster3Euro: 0,
  },
];

/**
 * Righe "volumi" inserite dall'imprenditore per un POS
 * (sono esattamente i campi blu della tabella Fisso).
 */
export interface AttivatoFissoRiga {
  categoria: FissoCategoriaType;
  pezzi: number;
}

export interface WorkdayInfo {
  totalWorkingDays: number;
  elapsedWorkingDays: number;
  remainingWorkingDays: number;
}

/**
 * Risultato completo Fisso per POS
 */
export interface CalcoloFissoPerPosResult {
  posCode: string;

  punti: number;
  runRateGiornalieroPunti: number;

  euroBase: number;

  soglia: number;

  premio: number;

  workdayInfo: WorkdayInfo;
}

/* -----------------------------------------------------------------------------
   Calendario & proiezioni (copiato dallo stile Mobile)
----------------------------------------------------------------------------- */

export function isStoreOpenOnDate(date: Date, calendar: StoreCalendar): boolean {
  const weekday = date.getDay() as Weekday;
  const baseOpen = calendar.weeklySchedule.workingDays.includes(weekday);

  const iso = date.toISOString().slice(0, 10);
  const special = calendar.specialDays?.find((s) => s.date === iso);
  if (special) return special.isOpen;

  return baseOpen;
}

export function getWorkdayInfoForMonth(
  year: number,
  monthIndex: number, // 0–11
  calendar: StoreCalendar,
  today: Date,
): WorkdayInfo {
  const firstDay = new Date(year, monthIndex, 1);
  const nextMonth = new Date(year, monthIndex + 1, 1);
  const lastDay = new Date(nextMonth.getTime() - 1);

  let totalWorkingDays = 0;
  let elapsedWorkingDays = 0;

  for (
    let d = new Date(firstDay);
    d <= lastDay;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  ) {
    if (!isStoreOpenOnDate(d, calendar)) continue;
    totalWorkingDays++;

    if (
      d.getFullYear() < today.getFullYear() ||
      (d.getFullYear() === today.getFullYear() &&
        (d.getMonth() < today.getMonth() ||
          (d.getMonth() === today.getMonth() && d.getDate() <= today.getDate())))
    ) {
      elapsedWorkingDays++;
    }
  }

  return {
    totalWorkingDays,
    elapsedWorkingDays,
    remainingWorkingDays: Math.max(totalWorkingDays - elapsedWorkingDays, 0),
  };
}

export function calcolaProiezione(
  valoreAttuale: number,
  workdayInfo: WorkdayInfo,
): { previstoFineMese: number; fattore: number } {
  const { totalWorkingDays, elapsedWorkingDays } = workdayInfo;
  if (elapsedWorkingDays === 0 || totalWorkingDays === 0) {
    return { previstoFineMese: valoreAttuale, fattore: 1 };
  }
  const fattore = totalWorkingDays / elapsedWorkingDays;
  return { previstoFineMese: valoreAttuale * fattore, fattore };
}

/* -----------------------------------------------------------------------------
   Soglie & moltiplicatori
----------------------------------------------------------------------------- */

export function determinaSogliaRaggiunta(
  punti: number,
  conf: PistaFissoPosConfig,
): number {
  const { soglia1, soglia2, soglia3, soglia4, soglia5 } = conf;
  if (punti >= soglia5) return 5;
  if (punti >= soglia4) return 4;
  if (punti >= soglia3) return 3;
  if (punti >= soglia2) return 2;
  if (punti >= soglia1) return 1;
  return 0;
}

export function getMultiplierForSoglia(
  soglia: number,
  conf: PistaFissoPosConfig,
): number {
  switch (soglia) {
    case 1:
      return conf.multiplierSoglia1;
    case 2:
      return conf.multiplierSoglia2;
    case 3:
      return conf.multiplierSoglia3;
    case 4:
      return conf.multiplierSoglia4;
    case 5:
      return conf.multiplierSoglia5;
    default:
      return 0;
  }
}

/* -----------------------------------------------------------------------------
   Funzione principale: calcolo pista FISSO per POS
----------------------------------------------------------------------------- */

/**
 * clusterFisso: 1/2/3 (serve per calcolare Extra CL3, solo sul cluster 3)
 */
export function calcolaPremioPistaFissoPerPos(params: {
  annoGara: number;
  meseGara: number; // 1–12
  calendar: StoreCalendar;
  clusterFisso: 1 | 2 | 3;
  posCode: string;
  pistaConfig: PistaFissoPosConfig;
  attivato: AttivatoFissoRiga[];
  categorieConfig?: FissoCategoriaConfig[]; // se non passi niente usa default
  today?: Date;
  workdayInfoOverride?: WorkdayInfo; // Usa questo se fornito (da calendario mese con override)
}): CalcoloFissoPerPosResult {
  const {
    annoGara,
    meseGara,
    calendar,
    clusterFisso,
    posCode,
    pistaConfig,
    attivato,
    categorieConfig = FISSO_CATEGORIE_DEFAULT,
    today = new Date(),
    workdayInfoOverride,
  } = params;

  const monthIndex = meseGara - 1;
  const categorieMap = new Map<FissoCategoriaType, FissoCategoriaConfig>();

  for (const c of categorieConfig) {
    categorieMap.set(c.type, c);
  }

  // Crea una mappa per accedere facilmente ai pezzi per categoria
  const pezziMap = new Map<FissoCategoriaType, number>();
  for (const r of attivato) {
    if (r.categoria && r.pezzi) {
      pezziMap.set(r.categoria, r.pezzi);
    }
  }

  const getPezzi = (tipo: FissoCategoriaType): number => pezziMap.get(tipo) || 0;

  // 1) Calcolo punti e gettone contrattuale (i volumi inseriti sono il target fine mese)
  let puntiTotali = 0;
  let gettoneContrattuale = 0;
  for (const r of attivato) {
    if (!r.categoria || !r.pezzi) continue;
    const cat = categorieMap.get(r.categoria);
    if (!cat) continue;
    puntiTotali += r.pezzi * cat.puntiPerPezzo;
    
    // Aggiungi gettone contrattuale
    const gettone = GETTONE_CONTRATTUALE_FISSO[r.categoria] ?? 0;
    gettoneContrattuale += r.pezzi * gettone;
  }

  // 2) Calendario - calcola run rate giornaliero
  const workdayInfo = workdayInfoOverride ?? getWorkdayInfoForMonth(annoGara, monthIndex, calendar, today);
  const runRateGiornalieroPunti = workdayInfo.totalWorkingDays > 0 
    ? puntiTotali / workdayInfo.totalWorkingDays 
    : 0;

  // 3) Determinazione soglia (basata sui punti finali inseriti)
  const soglia = determinaSogliaRaggiunta(puntiTotali, pistaConfig);

  // 4) Calcolo euro premio con logica canoni
  const mult = getMultiplierForSoglia(soglia, pistaConfig);

  // Funzione helper per calcolare il premio di una categoria con canoni
  const calcolaPremioCategoria = (
    tipo: FissoCategoriaType,
    moltiplicatoreSoglia: number,
    canoneBase: number = 23,
    canoniAggiuntivi: number = 0
  ): number => {
    const pezzi = getPezzi(tipo);
    if (pezzi === 0) return 0;
    return pezzi * ((canoneBase + canoniAggiuntivi * 23) * moltiplicatoreSoglia);
  };

  // Calcolo premio (senza gettone contrattuale - lo aggiungiamo dopo)
  let premioBase = 0;
  
  // FTTC: canone base 23€ + moltiplicatore
  premioBase += calcolaPremioCategoria("FISSO_FTTC", mult);
  
  // FTTH: canone base 23€ * moltiplicatore + 23€ fissi (non moltiplicati)
  premioBase += calcolaPremioCategoria("FISSO_FTTH", mult) + getPezzi("FISSO_FTTH") * 23;
  
  // FWA OUT: canone base 23€ * moltiplicatore + 34,5€ fissi (non moltiplicati)
  premioBase += calcolaPremioCategoria("FISSO_FWA_OUT", mult) + getPezzi("FISSO_FWA_OUT") * 34.5;
  
  // FWA IND 2P: canone base 23€ * moltiplicatore + 34,5€ fissi (non moltiplicati)
  premioBase += calcolaPremioCategoria("FISSO_FWA_IND_2P", mult) + getPezzi("FISSO_FWA_IND_2P") * 34.5;
  
  // FRITZ BOX: solo 40€ per pezzo (fisso, non dipende da moltiplicatori)
  premioBase += getPezzi("FRITZ_BOX") * 40;
  
  // NETFLIX CON ADV: bonus fisso 5€ per pezzo
  premioBase += getPezzi("NETFLIX_CON_ADV") * 5;
  
  // NETFLIX SENZA ADV: bonus fisso 10€ per pezzo
  premioBase += getPezzi("NETFLIX_SENZA_ADV") * 10;
  
  // CONVERGENZA: bonus fisso 46€ per pezzo
  premioBase += getPezzi("CONVERGENZA") * 46;
  
  // LINEA ATTIVA: bonus fisso 23€ per pezzo
  premioBase += getPezzi("LINEA_ATTIVA") * 23;
  
  // FISSO P.IVA 1ª LINEA: canone base 23€ + 1 canone aggiuntivo + moltiplicatore
  premioBase += calcolaPremioCategoria("FISSO_PIVA_1A_LINEA", mult, 23, 1);
  
  // FISSO P.IVA 2ª LINEA: canone base 10€ (eccezione) + 1 canone aggiuntivo (23€) + moltiplicatore
  const pezzi2aLinea = getPezzi("FISSO_PIVA_2A_LINEA");
  if (pezzi2aLinea > 0) {
    premioBase += pezzi2aLinea * ((10 + 1 * 23) * mult);
  }
  
  // PIÙ SICURI CASA E UFFICIO: bonus fisso 2€ per pezzo
  premioBase += getPezzi("PIU_SICURI_CASA_UFFICIO") * 2;
  
  // ASSICURAZIONI PLUS/FULL: solo punti, nessun premio euro
  // premioBase += calcolaPremioCategoria("ASSICURAZIONI_PLUS_FULL", mult);
  
  // CHIAMATE ILLIMITATE: moltiplicatore speciale in base alla soglia
  const pezziChiamate = getPezzi("CHIAMATE_ILLIMITATE");
  if (pezziChiamate > 0) {
    let multChiamate = 0;
    if (soglia === 1) multChiamate = 0.25;
    else if (soglia === 2) multChiamate = 0.5;
    else if (soglia === 3) multChiamate = 0.75;
    else if (soglia === 4) multChiamate = 1;
    else if (soglia === 5) multChiamate = 1.5;
    premioBase += pezziChiamate * 23 * multChiamate;
  }
  
  // BOLLETTINO POSTALE: gettone fisso in base alla soglia (no canone/moltiplicatore base)
  const pezziBollettino = getPezzi("BOLLETTINO_POSTALE");
  if (pezziBollettino > 0) {
    let gettoneBollettino = 23; // base
    if (soglia === 1) gettoneBollettino = 38;
    else if (soglia === 2) gettoneBollettino = 43;
    else if (soglia === 3) gettoneBollettino = 45;
    else if (soglia === 4) gettoneBollettino = 48;
    else if (soglia === 5) gettoneBollettino = 53;
    premioBase += pezziBollettino * gettoneBollettino;
  }
  
  // MIGRAZIONI VS FTTH/FWA: gettone fisso 40€ per pezzo, nessun punto
  premioBase += getPezzi("MIGRAZIONI_FTTH_FWA") * 40;
  
  // Premio totale = premio base + gettone contrattuale
  const premio = premioBase + gettoneContrattuale;

  return {
    posCode,
    punti: puntiTotali,
    runRateGiornalieroPunti,
    euroBase: premioBase,
    soglia,
    premio,
    workdayInfo,
  };
}
