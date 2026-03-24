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

export interface PdfGaraData {
  codiciDealer: string[];
  pdvList: PdfPdvEntry[];
  soglieMobile: PdfSoglieMobile | null;
  soglieFisso: PdfSoglieFisso | null;
  soglieExtraPIva: PdfSoglieExtraPIva | null;
  nomeRS: string;
  mese: string;
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
  const dealerPattern = /\b(8\d{9})\b/g;

  const lines = text.split('\n');
  const fullText = text;

  const allegatoIdx = fullText.indexOf('ALLEGATO');
  if (allegatoIdx === -1) return pdvEntries;

  const allegatoText = fullText.substring(allegatoIdx);

  const posMatches = [...allegatoText.matchAll(posPattern)];
  const dealerMatches = [...allegatoText.matchAll(dealerPattern)];

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

function parseSoglieMobile(text: string): PdfSoglieMobile | null {
  const pistaIdx = text.indexOf('PISTA MOBILE');
  if (pistaIdx === -1) return null;

  const afterPista = text.substring(pistaIdx, pistaIdx + 600);

  const sogliaLabels = /S\s*1\s+S\s*2\s+S\s*3\s+S\s*4/i;
  const labelMatch = afterPista.match(sogliaLabels);
  if (labelMatch) {
    const afterLabels = afterPista.substring(labelMatch.index! + labelMatch[0].length);
    const nums = [...afterLabels.matchAll(/\b(\d{2,4})\b/g)]
      .map(m => parseInt(m[1]))
      .filter(n => n >= 50 && n <= 5000);
    if (nums.length >= 4) {
      return { s1: nums[0], s2: nums[1], s3: nums[2], s4: nums[3] };
    }
  }

  const numbers = [...afterPista.matchAll(/\b(\d{3,4})\b/g)]
    .map(m => parseInt(m[1]))
    .filter(n => n >= 50 && n <= 5000);

  if (numbers.length >= 4) {
    const sorted = [...numbers].sort((a, b) => a - b);
    return { s1: sorted[0], s2: sorted[1], s3: sorted[2], s4: sorted[3] };
  }

  return null;
}

function parseSoglieFisso(text: string): PdfSoglieFisso | null {
  const pistaIdx = text.indexOf('PISTA FISSO');
  if (pistaIdx === -1) return null;

  const afterPista = text.substring(pistaIdx, pistaIdx + 600);

  const sogliaLabels = /S\s*1\s+S\s*2\s+S\s*3\s+S\s*4\s+S\s*5/i;
  const labelMatch = afterPista.match(sogliaLabels);
  if (labelMatch) {
    const afterLabels = afterPista.substring(labelMatch.index! + labelMatch[0].length);
    const nums = [...afterLabels.matchAll(/\b(\d{2,4})\b/g)]
      .map(m => parseInt(m[1]))
      .filter(n => n >= 10 && n <= 3000);
    if (nums.length >= 5) {
      return { s1: nums[0], s2: nums[1], s3: nums[2], s4: nums[3], s5: nums[4] };
    }
  }

  const numbers = [...afterPista.matchAll(/\b(\d{2,4})\b/g)]
    .map(m => parseInt(m[1]))
    .filter(n => n >= 10 && n <= 3000);

  if (numbers.length >= 5) {
    const sorted = [...numbers].sort((a, b) => a - b);
    return { s1: sorted[0], s2: sorted[1], s3: sorted[2], s4: sorted[3], s5: sorted[4] };
  }

  return null;
}

function parseSoglieExtraPIva(text: string): PdfSoglieExtraPIva | null {
  const pistaIdx = text.indexOf('PISTA EXTRA PARTITA IVA');
  if (pistaIdx === -1) return null;

  const afterPista = text.substring(pistaIdx, pistaIdx + 500);

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

export async function parseGaraPdf(file: File): Promise<PdfGaraData> {
  const text = await extractTextFromPdf(file);

  const pdvList = parsePdvTable(text);

  const codiciDealer = [...new Set(pdvList.map(p => p.codiceDealer).filter(Boolean))];

  if (codiciDealer.length === 0) {
    const dealerMatches = [...text.matchAll(/Cod\.\s*Dealer:\s*(8\d{9})/gi)];
    for (const m of dealerMatches) {
      if (!codiciDealer.includes(m[1])) codiciDealer.push(m[1]);
    }
  }

  const soglieMobile = parseSoglieMobile(text);
  const soglieFisso = parseSoglieFisso(text);
  const soglieExtraPIva = parseSoglieExtraPIva(text);
  const nomeRS = parseNomeRS(text);
  const mese = parseMese(text);

  return {
    codiciDealer,
    pdvList,
    soglieMobile,
    soglieFisso,
    soglieExtraPIva,
    nomeRS,
    mese,
  };
}
