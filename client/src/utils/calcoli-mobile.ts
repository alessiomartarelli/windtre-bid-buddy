import {
  AttivatoMobileDettaglio,
  MobileCategoryConfig,
  MobileActivationType,
  AggregateMobileResult,
  PistaMobilePosConfig,
  CalcoloPistaMobilePosResult,
  StoreCalendar,
  WorkdayInfo,
} from "@/types/preventivatore";
import {
  getWorkdayInfoForMonth,
  calcolaProiezionePezzi,
} from "./calendario";

function determinaSogliaRaggiunta(
  punti: number,
  configPos: PistaMobilePosConfig
): number {
  const { soglia1, soglia2, soglia3, soglia4 } = configPos;
  if (soglia4 && punti >= soglia4) return 4;
  if (punti >= soglia3) return 3;
  if (punti >= soglia2) return 2;
  if (punti >= soglia1) return 1;
  return 0;
}

function getMultiplierForSoglia(
  soglia: number,
  configPos: PistaMobilePosConfig
): number {
  switch (soglia) {
    case 1:
      return configPos.multiplierSoglia1;
    case 2:
      return configPos.multiplierSoglia2;
    case 3:
      return configPos.multiplierSoglia3;
    case 4:
      return configPos.multiplierSoglia4 ?? configPos.multiplierSoglia3;
    default:
      return 0;
  }
}

// Gettone contrattuale Mobile: 5€ per TIED, 1€ per UNTIED
const GETTONE_CONTRATTUALE_MOBILE: Partial<Record<MobileActivationType, number>> = {
  TIED: 5,
  UNTIED: 1,
};

export function aggregateMobileAttivato(
  dettaglio: AttivatoMobileDettaglio[],
  categories: MobileCategoryConfig[],
  sogliaRaggiunta?: number
): AggregateMobileResult & { gettoneContrattualeEuro: number; gettoneSogliaEuro: number } {
  let attivazioniValide = 0;
  let puntiTotali = 0;
  let extraGettoniEuro = 0;
  let gettoneContrattualeEuro = 0;
  let gettoneSogliaEuro = 0;

  for (const riga of dettaglio) {
    if (!riga.type || !riga.pezzi) continue;
    const conf = categories.find((c) => c.type === riga.type);
    if (!conf) continue;

    const pezzi = riga.pezzi;
    if (conf.contaSuCanoneMedio) attivazioniValide += pezzi;
    puntiTotali += pezzi * conf.punti;
    if (conf.extraGettoneEuro) {
      extraGettoniEuro += pezzi * conf.extraGettoneEuro;
    }
    
    // Calcola gettone contrattuale
    const gettone = GETTONE_CONTRATTUALE_MOBILE[riga.type];
    if (gettone) {
      gettoneContrattualeEuro += pezzi * gettone;
    }

    // Calcola gettone per soglia (es: bollettino postale)
    if (conf.gettonePerSoglia) {
      const gs = conf.gettonePerSoglia;
      let gettoneUnitario = gs.base;
      if (sogliaRaggiunta && sogliaRaggiunta >= 1) {
        const bonusPerSoglia = [0, gs.soglia1, gs.soglia2, gs.soglia3, gs.soglia4];
        gettoneUnitario += bonusPerSoglia[Math.min(sogliaRaggiunta, 4)];
      }
      gettoneSogliaEuro += pezzi * gettoneUnitario;
    }
  }

  return { attivazioniValide, puntiTotali, extraGettoniEuro, gettoneContrattualeEuro, gettoneSogliaEuro };
}

export function calcolaPremioPistaMobilePerPos(options: {
  configPos: PistaMobilePosConfig;
  dettaglio: AttivatoMobileDettaglio[];
  calendar: StoreCalendar;
  year: number;
  month: number;
  mobileCategories: MobileCategoryConfig[];
  today?: Date;
  workdayInfoOverride?: WorkdayInfo;
}): CalcoloPistaMobilePosResult & { extraGettoniEuro: number; gettoneContrattualeEuro: number; gettoneSogliaEuro: number } {
  const {
    configPos,
    dettaglio,
    calendar,
    year,
    month,
    mobileCategories,
    today = new Date(),
    workdayInfoOverride,
  } = options;

  // Prima passata per calcolare punti e soglia (senza gettoni soglia)
  const aggPreliminare = aggregateMobileAttivato(dettaglio, mobileCategories, 0);
  
  // Usa workdayInfo passato oppure calcola dal calendario base
  const workdayInfo = workdayInfoOverride ?? getWorkdayInfoForMonth(year, month, calendar, today);

  // I volumi inseriti sono il target fine mese
  const attivazioni = aggPreliminare.attivazioniValide;
  const punti = aggPreliminare.puntiTotali;

  // Soglia basata sui punti inseriti (target fine mese)
  const soglia = determinaSogliaRaggiunta(punti, configPos);

  // Seconda passata con soglia nota per calcolare gettoni variabili
  const agg = aggregateMobileAttivato(dettaglio, mobileCategories, soglia);

  // Calcola run rate giornaliero
  const runRateGiornalieroPunti = workdayInfo.totalWorkingDays > 0 
    ? punti / workdayInfo.totalWorkingDays 
    : 0;
  const runRateGiornalieroAttivazioni = workdayInfo.totalWorkingDays > 0 
    ? attivazioni / workdayInfo.totalWorkingDays 
    : 0;

  const valoreCanoni = attivazioni * configPos.canoneMedio;

  const mult = getMultiplierForSoglia(soglia, configPos);

  // Premio = moltiplicatore * canoni + gettone contrattuale + gettoni per soglia
  const premio = mult * valoreCanoni + agg.gettoneContrattualeEuro + agg.gettoneSogliaEuro;

  let forecastRaggiungimentoPercent: number | undefined;
  let forecastGapPunti: number | undefined;
  const target = configPos.forecastTargetPunti;

  if (target && target > 0) {
    forecastRaggiungimentoPercent = (punti / target) * 100;
    forecastGapPunti = punti - target;
  }

  return {
    posCode: configPos.posCode,
    soglia,
    premio,
    forecastTargetPunti: target,
    forecastRaggiungimentoPercent,
    forecastGapPunti,
    workdayInfo,
    punti,
    attivazioni,
    runRateGiornalieroPunti,
    runRateGiornalieroAttivazioni,
    extraGettoniEuro: agg.extraGettoniEuro,
    gettoneContrattualeEuro: agg.gettoneContrattualeEuro,
    gettoneSogliaEuro: agg.gettoneSogliaEuro,
  };
}
