import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface PdfPdvEntry {
  codicePos: string;
  codiceDealer: string;
  indirizzo: string;
  comune: string;
  provincia: string;
  posizione: string;
  clusterMobile: number;
  clusterFisso: number;
}

export interface PdfSoglieMobile {
  s1: number;
  s2: number;
  s3: number;
  s4: number;
}

export interface PdfSoglieFisso {
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  s5: number;
}

export interface PdfSoglieExtraPIva {
  cluster: string;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
}

export interface PdfPartnershipTarget {
  target100: number;
  premio100: number;
  target80: number;
  premio80: number;
}

export interface PdfSoglieEnergia {
  targetS1: number;
  targetS2: number;
  targetS3: number;
  targetNoMalus: number;
  targetFissoRS: number;
  premioS1: number;
  premioS2: number;
  premioS3: number;
}

export interface PdfSoglieAssicurazioni {
  targetS1: number;
  targetS2: number;
  targetNoMalus: number;
  premioS1: number;
  premioS2: number;
}

export interface PdfSoglieProtecta {
  targetExtra: number;
  premioExtra: number;
  targetDecurtazione: number;
}

export interface PdfDecurtazione {
  importo: number;
}

export type PdfType = 'fonia_mobile_fissa' | 'partnership_reward';

export interface PdfGaraData {
  pdfType: PdfType;
  codiciDealer: string[];
  pdvList: PdfPdvEntry[];
  soglieMobile: PdfSoglieMobile | null;
  soglieFisso: PdfSoglieFisso | null;
  soglieExtraPIva: PdfSoglieExtraPIva | null;
  nomeRS: string;
  mese: string;
  partnershipTarget: PdfPartnershipTarget | null;
  soglieEnergia: PdfSoglieEnergia | null;
  soglieAssicurazioni: PdfSoglieAssicurazioni | null;
  soglieProtecta: PdfSoglieProtecta | null;
  decurtazione: PdfDecurtazione | null;
}

async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const textParts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => item.str)
      .join(' ');
    textParts.push(pageText);
  }

  return textParts.join('\n');
}

function parsePdvTable(text: string): PdfPdvEntry[] {
  const pdvEntries: PdfPdvEntry[] = [];

  const posPattern = /\b(9\d{9})\b/g;

  const fullText = text;

  const allegatoIdx = fullText.indexOf('ALLEGATO');
  if (allegatoIdx === -1) return pdvEntries;

  const allegatoText = fullText.substring(allegatoIdx);

  const posMatches = [...allegatoText.matchAll(posPattern)];

  if (posMatches.length === 0) return pdvEntries;

  for (const posMatch of posMatches) {
    const posCode = posMatch[1];
    const posIndex = posMatch.index!;

    const surroundingText = allegatoText.substring(
      Math.max(0, posIndex - 20),
      Math.min(allegatoText.length, posIndex + 300)
    );

    let dealerCode = '';
    const dealerInContext = surroundingText.match(/\b(8\d{9})\b/);
    if (dealerInContext) {
      dealerCode = dealerInContext[1];
    }

    const clusterNumbers = surroundingText.match(/\b([1-3])\s+([1-3])\s*$/m) ||
      surroundingText.match(/([1-3])\s+([1-3])\s*(?:\n|$)/);

    let clusterMobile = 0;
    let clusterFisso = 0;

    if (clusterNumbers) {
      clusterMobile = parseInt(clusterNumbers[1]);
      clusterFisso = parseInt(clusterNumbers[2]);
    } else {
      const afterPos = allegatoText.substring(posIndex);
      const nextPosMatch = afterPos.match(/\b9\d{9}\b/);
      const endIdx = nextPosMatch ? (nextPosMatch.index || 300) : 300;
      const segment = afterPos.substring(0, endIdx);

      const allNums = [...segment.matchAll(/\b([1-3])\b/g)];
      if (allNums.length >= 2) {
        clusterMobile = parseInt(allNums[allNums.length - 2][1]);
        clusterFisso = parseInt(allNums[allNums.length - 1][1]);
      }
    }

    pdvEntries.push({
      codicePos: posCode,
      codiceDealer: dealerCode,
      indirizzo: '',
      comune: '',
      provincia: '',
      posizione: '',
      clusterMobile,
      clusterFisso,
    });
  }

  return pdvEntries;
}

function extractSectionText(text: string, sectionMarker: string, nextMarkers: string[]): string | null {
  const idx = text.indexOf(sectionMarker);
  if (idx === -1) return null;

  const afterMarker = text.substring(idx);

  let endIdx = afterMarker.length;
  for (const marker of nextMarkers) {
    const markerIdx = afterMarker.indexOf(marker, sectionMarker.length);
    if (markerIdx !== -1 && markerIdx < endIdx) {
      endIdx = markerIdx;
    }
  }

  return afterMarker.substring(0, endIdx);
}

function extractSoglieFromSection(sectionText: string, count: number, minVal: number, maxVal: number): number[] | null {
  const sogliaLabelPattern = /[1-5][°^a]\s*soglia/gi;
  const labelMatches = [...sectionText.matchAll(sogliaLabelPattern)];

  if (labelMatches.length >= count) {
    const lastLabel = labelMatches[count - 1];
    const afterLabels = sectionText.substring(lastLabel.index! + lastLabel[0].length);
    const nums = [...afterLabels.matchAll(/\b(\d{2,4})\b/g)]
      .map(m => parseInt(m[1]))
      .filter(n => n >= minVal && n <= maxVal);
    if (nums.length >= count) {
      return nums.slice(0, count);
    }
  }

  const s1s2Pattern = /S\s*1\s+S\s*2/i;
  const s1s2Match = sectionText.match(s1s2Pattern);
  if (s1s2Match) {
    const afterLabels = sectionText.substring(s1s2Match.index! + s1s2Match[0].length);
    const nums = [...afterLabels.matchAll(/\b(\d{2,4})\b/g)]
      .map(m => parseInt(m[1]))
      .filter(n => n >= minVal && n <= maxVal);
    if (nums.length >= count) {
      return nums.slice(0, count);
    }
  }

  const numbers = [...sectionText.matchAll(/\b(\d{3,4})\b/g)]
    .map(m => parseInt(m[1]))
    .filter(n => n >= minVal && n <= maxVal);

  if (numbers.length >= count) {
    const sorted = [...numbers].sort((a, b) => a - b);
    return sorted.slice(0, count);
  }

  return null;
}

function parseSoglieMobile(text: string): PdfSoglieMobile | null {
  const sectionText = extractSectionText(text, 'PISTA MOBILE', ['PISTA FISSO', 'PISTA EXTRA', 'ALLEGATO']);
  if (!sectionText) return null;

  const nums = extractSoglieFromSection(sectionText, 4, 50, 5000);
  if (!nums) return null;

  return { s1: nums[0], s2: nums[1], s3: nums[2], s4: nums[3] };
}

function parseSoglieFisso(text: string): PdfSoglieFisso | null {
  const sectionText = extractSectionText(text, 'PISTA FISSO', ['PISTA EXTRA', 'PISTA MOBILE', 'ALLEGATO']);
  if (!sectionText) return null;

  const nums = extractSoglieFromSection(sectionText, 5, 10, 3000);
  if (!nums) return null;

  return { s1: nums[0], s2: nums[1], s3: nums[2], s4: nums[3], s5: nums[4] };
}

function parseSoglieExtraPIva(text: string): PdfSoglieExtraPIva | null {
  const sectionText = extractSectionText(text, 'PISTA EXTRA PARTITA IVA', ['PISTA MOBILE', 'PISTA FISSO', 'ALLEGATO']);
  if (!sectionText) return null;

  const afterPista = sectionText;

  let cluster = '';
  if (afterPista.includes('BUSINESS PROMOTER PLUS') || afterPista.includes('PROMOTER PLUS')) {
    cluster = 'business_promoter_plus';
  } else if (afterPista.includes('SENZA BUSINESS') || afterPista.includes('NO BUSINESS')) {
    cluster = 'senza_business_promoter';
  } else if (afterPista.includes('BUSINESS PROMOTER') || afterPista.includes('PROMOTER')) {
    cluster = 'business_promoter';
  }

  const clusterLineIdx = afterPista.indexOf('CLUSTER');
  if (clusterLineIdx === -1) return null;

  const afterCluster = afterPista.substring(clusterLineIdx);
  const numbers = [...afterCluster.matchAll(/\b(\d{2,4})\b/g)]
    .map(m => parseInt(m[1]))
    .filter(n => n >= 10 && n <= 2000);

  if (numbers.length >= 4) {
    return { cluster, s1: numbers[0], s2: numbers[1], s3: numbers[2], s4: numbers[3] };
  }

  return null;
}

function parseNomeRS(text: string): string {
  const spettleMatch = text.match(/Spett\.le\s+(.+?)(?:\s+Cod\.\s*Dealer|\n)/i);
  if (spettleMatch) {
    return spettleMatch[1].trim();
  }
  return '';
}

function parseMese(text: string): string {
  const meseMatch = text.match(/INCENTIVAZIONE\s+([\wÀ-ÿ]+)\s+(\d{4})/i);
  if (meseMatch) {
    return `${meseMatch[1]} ${meseMatch[2]}`;
  }
  return '';
}

function parseMesePartnership(text: string): string {
  const meseMatch = text.match(/PARTNERSHIP\s+REWARD\s+([\wÀ-ÿ]+)\s+(\d{4})/i);
  if (meseMatch) {
    return `${meseMatch[1]} ${meseMatch[2]}`;
  }
  return '';
}

function parseEuroAmount(str: string): number {
  const cleaned = str.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
}

function parseAllegatoA(text: string): PdfPartnershipTarget | null {
  const section = extractSectionText(text, 'ALLEGATO A', ['ALLEGATO B', 'ALLEGATO C', 'ALLEGATO D', 'ALLEGATO E']);
  if (!section) return null;

  const targetMatch = section.match(/(?:TARGET\s+PARTNERSHIP|PARTNERSHIP)\s*\n?\s*(\d[\d.]*)/i)
    || section.match(/\b(\d{3,5})\b/);
  if (!targetMatch) return null;

  const target100 = parseInt(targetMatch[1].replace(/\./g, ''));

  const euroMatches = [...section.matchAll(/([\d.]+)\s*€/g)];
  if (euroMatches.length < 2) return null;

  const premio100 = parseEuroAmount(euroMatches[0][1]);
  const premio80 = parseEuroAmount(euroMatches[1][1]);

  const target80 = Math.round(target100 * 0.8);

  return { target100, premio100, target80, premio80 };
}

function parseAllegatoB(text: string): PdfSoglieEnergia | null {
  const section = extractSectionText(text, 'ALLEGATO B', ['ALLEGATO C', 'ALLEGATO D', 'ALLEGATO E']);
  if (!section) return null;

  console.log('[parseAllegatoB] section:', section);

  const premioS1Match = section.match(/(\d{3,5})\s*€\s*(?:per|\/)\s*(?:pdv|punto)/i);
  const premioS1 = premioS1Match ? parseInt(premioS1Match[1]) : 250;

  const minMatch = section.match(/min(?:imo)?\s*(?:di\s+)?(\d{3,5})\s*€/i);
  let premioS2 = 500;
  if (minMatch) {
    premioS2 = parseInt(minMatch[1]);
  }

  const premioS3Matches = [...section.matchAll(/([\d.]+)\s*€\s*(?:per|\/)\s*(?:pdv|punto)/gi)];
  let premioS3 = 1000;
  if (premioS3Matches.length >= 2) {
    const val = premioS3Matches[premioS3Matches.length - 1][1];
    premioS3 = parseInt(val.replace(/\./g, ''));
  }

  const lessThanMatch = section.match(/<\s*(\d{1,4})/);
  const targetNoMalus = lessThanMatch ? parseInt(lessThanMatch[1]) : 0;

  const lastHeaderMatch = section.match(/(?:per\s+PDV|1[°ª]\s*soglia|Decurtazione\s+Premio\s+per\s+PDV)\s*/gi);
  let searchArea = section;
  if (lastHeaderMatch) {
    const lastIdx = section.lastIndexOf(lastHeaderMatch[lastHeaderMatch.length - 1]);
    if (lastIdx !== -1) {
      searchArea = section.substring(lastIdx);
    }
  }

  const allNumbers = [...searchArea.matchAll(/\b(\d{2,4})\b/g)]
    .map(m => parseInt(m[1]))
    .filter(n => n !== targetNoMalus && n >= 10 && n <= 5000);

  const uniqueNumbers = allNumbers.filter(n => {
    if (n === premioS1 || n === premioS2 || n === premioS3) return false;
    return true;
  });

  const targetCandidates = uniqueNumbers.length >= 3 ? uniqueNumbers : allNumbers;

  if (targetCandidates.length < 3) return null;

  return {
    targetS1: targetCandidates[0],
    targetS2: targetCandidates[1],
    targetS3: targetCandidates[2],
    targetNoMalus,
    targetFissoRS: targetCandidates.length >= 4 ? targetCandidates[3] : 0,
    premioS1,
    premioS2,
    premioS3,
  };
}

function parseAllegatoC(text: string): PdfSoglieAssicurazioni | null {
  const section = extractSectionText(text, 'ALLEGATO C', ['ALLEGATO D', 'ALLEGATO E']);
  if (!section) return null;

  console.log('[parseAllegatoC] section:', section);

  const premioHeaderMatches = [...section.matchAll(/(\d{3,5})\s*€\s*(?:per|\/)\s*(?:pdv|punto)/gi)];
  const premioS1 = premioHeaderMatches.length >= 1 ? parseInt(premioHeaderMatches[0][1]) : 500;
  const premioS2 = premioHeaderMatches.length >= 2 ? parseInt(premioHeaderMatches[1][1]) : 750;

  const lessThanMatch = section.match(/<\s*(\d{1,4})/);
  const targetNoMalus = lessThanMatch ? parseInt(lessThanMatch[1]) : 0;

  const lastHeaderMatch = section.match(/(?:per\s+PDV|Decurtazione\s+Premio\s+per\s+PDV)\s*/gi);
  let searchArea = section;
  if (lastHeaderMatch) {
    const lastIdx = section.lastIndexOf(lastHeaderMatch[lastHeaderMatch.length - 1]);
    if (lastIdx !== -1) {
      searchArea = section.substring(lastIdx);
    }
  }

  const allNumbers = [...searchArea.matchAll(/\b(\d{2,4})\b/g)]
    .map(m => parseInt(m[1]))
    .filter(n => n !== targetNoMalus && n >= 10 && n <= 5000);

  const uniqueNumbers = allNumbers.filter(n => {
    if (n === premioS1 || n === premioS2) return false;
    return true;
  });

  const targetCandidates = uniqueNumbers.length >= 2 ? uniqueNumbers : allNumbers;

  if (targetCandidates.length < 2) return null;

  return {
    targetS1: targetCandidates[0],
    targetS2: targetCandidates[1],
    targetNoMalus,
    premioS1,
    premioS2,
  };
}

function parseAllegatoD(text: string): PdfSoglieProtecta | null {
  const section = extractSectionText(text, 'ALLEGATO D', ['ALLEGATO E', 'Wind Tre S.p.A. con Socio Unico']);
  if (!section) return null;

  console.log('[parseAllegatoD] section:', section);

  const premioHeaderMatch = section.match(/(\d{2,4})\s*€\s*(?:per|\/)\s*(?:pdv|punto)/i);
  const premioExtra = premioHeaderMatch ? parseInt(premioHeaderMatch[1]) : 350;

  const geqMatches = [...section.matchAll(/[≥>=]+\s*(\d{1,4})/g)];
  let targetExtra = 0;
  if (geqMatches.length > 0) {
    const lastGeq = geqMatches[geqMatches.length - 1];
    targetExtra = parseInt(lastGeq[1]);
  }

  const lessThanMatches = [...section.matchAll(/<\s*(\d{1,4})/g)];
  let targetDecurtazione = 0;
  if (lessThanMatches.length > 0) {
    const lastLt = lessThanMatches[lessThanMatches.length - 1];
    targetDecurtazione = parseInt(lastLt[1]);
  }

  if (targetExtra === 0 && targetDecurtazione === 0) return null;

  return { targetExtra, premioExtra, targetDecurtazione };
}

function parseAllegatoE(text: string): PdfDecurtazione | null {
  const section = extractSectionText(text, 'ALLEGATO E', ['Wind Tre S.p.A. con Socio Unico']);
  if (!section) return null;

  const euroMatches = [...section.matchAll(/([\d.]+)\s*€/g)];
  if (euroMatches.length === 0) return null;

  const importo = parseEuroAmount(euroMatches[0][1]);
  if (importo === 0) return null;

  return { importo };
}

function detectPdfType(text: string): PdfType {
  if (text.includes('PARTNERSHIP REWARD') || text.includes('Partnership Reward')) {
    return 'partnership_reward';
  }
  return 'fonia_mobile_fissa';
}

export async function parseGaraPdf(file: File): Promise<PdfGaraData> {
  const text = await extractTextFromPdf(file);

  const pdfType = detectPdfType(text);

  const codiciDealer: string[] = [];
  const dealerMatches = [...text.matchAll(/Cod\.\s*Dealer:\s*(8\d{9})/gi)];
  for (const m of dealerMatches) {
    if (!codiciDealer.includes(m[1])) codiciDealer.push(m[1]);
  }

  const nomeRS = parseNomeRS(text);

  if (pdfType === 'partnership_reward') {
    console.log('[parseGaraPdf] Full text:', text);
    console.log('[parseGaraPdf] Has ALLEGATO A:', text.includes('ALLEGATO A'));
    console.log('[parseGaraPdf] Has ALLEGATO B:', text.includes('ALLEGATO B'));
    console.log('[parseGaraPdf] Has ALLEGATO C:', text.includes('ALLEGATO C'));
    console.log('[parseGaraPdf] Has ALLEGATO D:', text.includes('ALLEGATO D'));
    console.log('[parseGaraPdf] Has ALLEGATO E:', text.includes('ALLEGATO E'));
    const mese = parseMesePartnership(text);
    const partnershipTarget = parseAllegatoA(text);
    const soglieEnergia = parseAllegatoB(text);
    const soglieAssicurazioni = parseAllegatoC(text);
    const soglieProtecta = parseAllegatoD(text);
    const decurtazione = parseAllegatoE(text);

    return {
      pdfType,
      codiciDealer,
      pdvList: [],
      soglieMobile: null,
      soglieFisso: null,
      soglieExtraPIva: null,
      nomeRS,
      mese,
      partnershipTarget,
      soglieEnergia,
      soglieAssicurazioni,
      soglieProtecta,
      decurtazione,
    };
  }

  const pdvList = parsePdvTable(text);

  if (codiciDealer.length === 0) {
    const pdvDealers = [...new Set(pdvList.map(p => p.codiceDealer).filter(Boolean))];
    codiciDealer.push(...pdvDealers);
  }

  const soglieMobile = parseSoglieMobile(text);
  const soglieFisso = parseSoglieFisso(text);
  const soglieExtraPIva = parseSoglieExtraPIva(text);
  const mese = parseMese(text);

  return {
    pdfType,
    codiciDealer,
    pdvList,
    soglieMobile,
    soglieFisso,
    soglieExtraPIva,
    nomeRS,
    mese,
    partnershipTarget: null,
    soglieEnergia: null,
    soglieAssicurazioni: null,
    soglieProtecta: null,
    decurtazione: null,
  };
}
