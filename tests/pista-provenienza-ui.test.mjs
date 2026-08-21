import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  uniq,
  signup,
  setRole,
  cleanupOrg,
  newPool,
  launchBrowser,
  newAuthedContext,
} from './helpers/uiTest.mjs';
import {
  calcolaPremioPistaFissoPerPos,
  getFissoAppliedMultipliersWithAddons,
} from '../client/src/lib/calcoloPistaFisso.ts';

// Task #489 — pannello "Provenienza punti" sulle card pista della Dashboard
// Gara Reale. Verifica che:
//   - la card pista apre/chiude il pannello via bottone dedicato (btn-
//     provenienza-<pista>, con aria-expanded) e via click sulla card stessa;
//   - il pannello mostra il totale punti della card e una riga per PDV con
//     punti calcolati dagli STESSI calcolatori della card;
//   - i subtotali PDV sommano ESATTAMENTE al totale ("= totale card");
//   - le fonti (categorie mappate con pezzi) sono elencate per ogni PDV;
//   - il contesto (periodo, vista PDV, filtro in-gara) è dichiarato;
//   - il pannello resta visibile e leggibile anche in tema scuro.
//
// Scenario deterministico: 2 PDV mobile con soglia1 = 3 punti:
//   PDV A: 2 SIM TIED × 0,75 pt = 1,50 pt
//   PDV B: 2 SIM TIED + 2 UNTIED × 0,75 pt = 3,00 pt
//   Totale card mobile = 4,50 pt → la somma dei subtotali deve quadrare.

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();
const DATA_VENDITA = `${YEAR}-${pad(MONTH)}-10T10:00:00.000Z`;

const artMobileTied = {
  categoria: { nome: 'TIED CF' },
  tipologia: { nome: 'VOCE EASYPAY' },
  dettaglio: { canone: '10' },
}; // mobile → TIED (0,75 punti)

const artMobileUntied = {
  categoria: { nome: 'UNTIED' },
  tipologia: { nome: 'RICARICABILE VOCE' },
  dettaglio: { canone: '10' },
}; // mobile → UNTIED (0,75 punti)

async function insertSale(pool, orgId, { codicePos, nomeNegozio, ragioneSociale, articoli }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        ragione_sociale, stato, totale, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, 'FINALIZZATA', '10.00', $7::jsonb)`,
    [orgId, bisuiteId, DATA_VENDITA, codicePos, nomeNegozio, ragioneSociale,
     JSON.stringify({ cliente: { clienteTipo: 'PRIVATO' }, articoli })],
  );
}

const provNum = (txt) => Number(String(txt).replace(/[^\d,.-]/g, '').replace(',', '.'));

// ── Task #491 — contrasto WCAG misurato nel pannello (temi scuri) ────────────
// Stessa matematica delle suite dark-contrast (tests/helpers/contrastScan.mjs),
// con una differenza: la card ticker ha uno sfondo a gradiente, quindi quando
// lo sfondo accumulato degli antenati non è opaco prima di incontrare il
// gradiente, il rapporto viene calcolato come LOWER BOUND componendo lo sfondo
// residuo sia su nero puro che su bianco puro e prendendo il minimo. Se anche
// il caso peggiore supera la soglia WCAG, il testo è leggibile davvero.
const setDarkScheme = async (pool, session, page, scheme) => {
  await pool.query(
    `UPDATE profiles
        SET ui_prefs = coalesce(ui_prefs, '{}'::jsonb) || $2::jsonb
      WHERE id = $1`,
    [session.profileId, JSON.stringify({ theme: 'dark', scheme })],
  );
  await page.evaluate((s) => {
    localStorage.setItem('mystoredesk-theme', 'dark');
    localStorage.setItem('mystoredesk-scheme', s);
  }, scheme);
};

const measurePanelContrast = (page, pista) =>
  page.evaluate((pistaKey) => {
    const parse = (raw) => {
      const m = raw.match(/[\d.]+/g);
      if (!m || m.length < 3) return null;
      const [r, g, b] = m.slice(0, 3).map(Number);
      return { r, g, b, a: m.length >= 4 ? Number(m[3]) : 1 };
    };
    const lum = ({ r, g, b }) => {
      const lin = (v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (f, bg) => {
      const lf = lum(f);
      const lb = lum(bg);
      return (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
    };
    const blendOver = (top, bottom) => {
      const a = top.a + bottom.a * (1 - top.a);
      return {
        r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
        g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
        b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
        a,
      };
    };
    const BLACK = { r: 0, g: 0, b: 0, a: 1 };
    const WHITE = { r: 255, g: 255, b: 255, a: 1 };

    const root = document.getElementById(`ticker-detail-${pistaKey}`);
    if (!root) return { missingRoot: true, results: [] };

    const results = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let el = root; el; el = walker.nextNode()) {
      if (!(el instanceof HTMLElement)) continue;
      const direct = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join('')
        .trim();
      if (!direct) continue;

      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;

      let opacity = 1;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        opacity *= Number(getComputedStyle(n).opacity || 1);
      }
      const fgRaw = parse(cs.color);
      if (!fgRaw) continue;
      const fgBase = { ...fgRaw, a: fgRaw.a * opacity };

      // Sfondo effettivo: fusione risalendo gli antenati; se si incontra un
      // gradiente con alpha accumulata < 1, si passa alla modalità bounded.
      let bg = null;
      let bounded = false;
      const chain = [];
      let node = el;
      while (node) {
        chain.push(node);
        node = node.parentElement;
      }
      chain.push(document.body, document.documentElement);
      for (const n of chain) {
        if (!n) continue;
        const ncs = getComputedStyle(n);
        if (ncs.backgroundImage && ncs.backgroundImage !== 'none') {
          if (!bg || bg.a < 0.999) bounded = true;
          break;
        }
        const c = parse(ncs.backgroundColor);
        if (c && c.a > 0) {
          bg = bg ? blendOver(bg, c) : c;
          if (bg.a >= 0.999) break;
        }
      }

      const size = parseFloat(cs.fontSize) || 16;
      const weight = Number(cs.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.5 && weight >= 700);
      const min = large ? 3.0 : 4.5;

      let r;
      if (bounded || !bg) {
        const base = bg ?? { r: 0, g: 0, b: 0, a: 0 };
        const bgDark = base.a > 0 ? blendOver(base, BLACK) : BLACK;
        const bgLight = base.a > 0 ? blendOver(base, WHITE) : WHITE;
        const fgDark = fgBase.a < 1 ? blendOver(fgBase, bgDark) : fgBase;
        const fgLight = fgBase.a < 1 ? blendOver(fgBase, bgLight) : fgBase;
        r = Math.min(ratio(fgDark, bgDark), ratio(fgLight, bgLight));
      } else {
        const solidBg = bg.a < 0.999 ? blendOver(bg, WHITE) : bg;
        const fg = fgBase.a < 1 ? blendOver(fgBase, solidBg) : fgBase;
        r = ratio(fg, solidBg);
      }

      results.push({
        ratio: Number(r.toFixed(2)),
        min,
        bounded,
        text: direct.slice(0, 60),
        testid: el.closest('[data-testid]')?.getAttribute('data-testid') || null,
      });
    }
    return { missingRoot: false, results };
  }, pista);

const assertPanelContrast = async (page, pista, label) => {
  const { missingRoot, results } = await measurePanelContrast(page, pista);
  assert.equal(missingRoot, false, `${label}: pannello ticker-detail-${pista} presente`);
  assert.ok(results.length > 0, `${label}: almeno un elemento testuale misurato`);

  // Copertura minima richiesta dal task: titolo, totale, subtotali PDV,
  // fonti (categorie) e riga somma devono essere stati misurati davvero.
  const hasText = (re) => results.some((x) => re.test(x.text));
  const hasTestid = (prefix) => results.some((x) => x.testid && x.testid.startsWith(prefix));
  assert.ok(hasText(/Provenienza punti/i), `${label}: titolo del pannello misurato`);
  assert.ok(hasTestid(`prov-totale-${pista}`), `${label}: totale pannello misurato`);
  assert.ok(hasTestid(`prov-punti-pdv-${pista}-`) || hasTestid(`prov-punti-rs-${pista}-`),
    `${label}: subtotali PDV/RS misurati`);
  assert.ok(hasTestid(`prov-cat-${pista}-`), `${label}: fonti (categorie) misurate`);
  assert.ok(hasTestid(`prov-somma-${pista}`), `${label}: riga somma misurata`);

  const violations = results.filter((x) => x.ratio < x.min);
  assert.equal(
    violations.length,
    0,
    `${label}: ${violations.length} violazioni di contrasto:\n` +
      violations
        .map((v) => `  - [${v.testid ?? '-'}] "${v.text}" ratio=${v.ratio} (min ${v.min}${v.bounded ? ', bounded' : ''})`)
        .join('\n'),
  );
};
test('Provenienza punti: il Fisso espone solo i moltiplicatori realmente applicati', () => {
  const pistaConfig = {
    posCode: 'FISSO-MULT',
    soglia1: 1,
    soglia2: 100,
    soglia3: 200,
    soglia4: 300,
    soglia5: 400,
    multiplierSoglia1: 2,
    multiplierSoglia2: 3,
    multiplierSoglia3: 3.5,
    multiplierSoglia4: 4,
    multiplierSoglia5: 5,
  };
  const common = {
    annoGara: YEAR,
    meseGara: MONTH,
    calendar: { weeklySchedule: { workingDays: [1, 2, 3, 4, 5, 6] } },
    clusterFisso: 1,
    posCode: pistaConfig.posCode,
    pistaConfig,
  };

  const fissoMoltiplicato = calcolaPremioPistaFissoPerPos({
    ...common,
    attivato: [{ categoria: 'FISSO_FTTC', pezzi: 1 }],
  });
  assert.equal(fissoMoltiplicato.soglia, 1);
  assert.deepEqual(fissoMoltiplicato.moltiplicatoriApplicati, [2],
    'FTTC raggiunge S1 e applica il moltiplicatore base ×2');

  const fissoSoloPremioFisso = calcolaPremioPistaFissoPerPos({
    ...common,
    attivato: [{ categoria: 'FRITZ_BOX', pezzi: 1 }],
  });
  assert.equal(fissoSoloPremioFisso.soglia, 1);
  assert.equal(fissoSoloPremioFisso.moltiplicatoriApplicati, undefined,
    'FRITZ BOX raggiunge S1 ma non dichiara ×2 perché il suo premio è fisso');

  assert.deepEqual(
    getFissoAppliedMultipliersWithAddons(undefined, 1, [
      { targetCategory: 'VOCE_UNLIMITED', canone: 23, occorrenze: 1 },
    ]),
    [0.25],
    'Voce Unlimited da solo espone il moltiplicatore di S1 ×0,25',
  );
  assert.deepEqual(
    getFissoAppliedMultipliersWithAddons([2], 1, [
      { targetCategory: 'VOCE_UNLIMITED', canone: 23, occorrenze: 1 },
    ]),
    [0.25, 2],
    'Voce Unlimited e una categoria base espongono entrambi i moltiplicatori',
  );
  assert.equal(
    getFissoAppliedMultipliersWithAddons(undefined, 1, [
      { targetCategory: 'VOCE_UNLIMITED', canone: 23, occorrenze: 0 },
    ]),
    undefined,
    'Voce Unlimited con zero occorrenze non dichiara un moltiplicatore non applicato',
  );

  const addonMultiplierCases = [
    ['LINEA_ATTIVA', 1],
    ['FIBRA_FTTH_ADDON', 1],
    ['CONVERGENZA', 2],
    ['CONVERGENZA_LUCE_GAS', 2],
    ['CONVERGENTE_ASSICUR', 2],
  ];
  for (const [targetCategory, expectedMultiplier] of addonMultiplierCases) {
    assert.deepEqual(
      getFissoAppliedMultipliersWithAddons(undefined, 1, [
        { targetCategory, canone: 23, occorrenze: 1 },
      ]),
      [expectedMultiplier],
      `${targetCategory} espone il proprio moltiplicatore ×${expectedMultiplier}`,
    );
  }

  assert.deepEqual(
    getFissoAppliedMultipliersWithAddons(undefined, 1, [
      { targetCategory: 'VOCE_UNLIMITED', canone: 23, occorrenze: 1 },
      { targetCategory: 'LINEA_ATTIVA', canone: 23, occorrenze: 1 },
      { targetCategory: 'CONVERGENZA_LUCE_GAS', canone: 23, occorrenze: 1 },
    ]),
    [0.25, 1, 2],
    'tutti i moltiplicatori add-on applicati sono esposti, ordinati e distinti',
  );

  for (const targetCategory of addonMultiplierCases.map(([category]) => category)) {
    assert.equal(
      getFissoAppliedMultipliersWithAddons(undefined, 1, [
        { targetCategory, canone: 0, occorrenze: 1 },
      ]),
      undefined,
      `${targetCategory} senza base economica non dichiara un moltiplicatore`,
    );
  }
});

test('Dashboard Gara Reale: pannello Provenienza punti riconciliabile col totale card', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'prov_punti', fullName: 'Provenienza Punti Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('PRVPOSA');
    const POS_B = uniq('PRVPOSB');
    const POS_NO_MODEL = uniq('PRVNOMD');
    const RS = uniq('ProvenienzaRs Srl');

    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [session.orgId, MONTH, YEAR, 'Provenienza punti test', JSON.stringify({
        pdvList: [
          { codicePos: POS_A, nome: 'Negozio Prov A', ragioneSociale: RS },
          { codicePos: POS_B, nome: 'Negozio Prov B', ragioneSociale: RS },
          { codicePos: POS_NO_MODEL, nome: 'Negozio senza modello', ragioneSociale: RS },
        ],
        pistaMobileConfig: {
          sogliePerPos: [POS_A, POS_B].map((posCode) => ({
            posCode,
            soglia1: 3, soglia2: 100, soglia3: 200, soglia4: 300,
            multiplierSoglia1: 1, multiplierSoglia2: 1.2,
            multiplierSoglia3: 1.5, multiplierSoglia4: 2,
          })),
        },
      })],
    );

    // PDV A: 2 TIED = 1,50 pt; PDV B: 2 TIED + 2 UNTIED = 3,00 pt.
    for (let i = 0; i < 2; i++) {
      await insertSale(pool, session.orgId, {
        codicePos: POS_A, nomeNegozio: 'Negozio Prov A', ragioneSociale: RS,
        articoli: [artMobileTied],
      });
    }
    // PDV B usa due gruppi canone: il badge deve dichiarare entrambi i
    // moltiplicatori realmente applicati (TIED ×2, GA base/UNTIED ×1).
    for (let i = 0; i < 2; i++) {
      await insertSale(pool, session.orgId, {
        codicePos: POS_B, nomeNegozio: 'Negozio Prov B', ragioneSociale: RS,
        articoli: [artMobileTied],
      });
      await insertSale(pool, session.orgId, {
        codicePos: POS_B, nomeNegozio: 'Negozio Prov B', ragioneSociale: RS,
        articoli: [artMobileUntied],
      });
    }
    // Questo PDV ha vendite Mobile ma nessuna configurazione soglie: non deve
    // ereditare il modello del primo PDV né mostrare marker fuorvianti.
    await insertSale(pool, session.orgId, {
      codicePos: POS_NO_MODEL, nomeNegozio: 'Negozio senza modello', ragioneSociale: RS,
      articoli: [artMobileTied],
    });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle', timeout: 45000 });

    const card = page.getByTestId('ticker-pista-mobile');
    await card.waitFor({ state: 'visible', timeout: 30000 });
    const panel = page.getByTestId('provenienza-panel-mobile');
    const btn = page.getByTestId('btn-provenienza-mobile');

    // Chiuso di default.
    assert.equal(await panel.count(), 0, 'pannello chiuso al primo render');
    assert.equal(await btn.getAttribute('aria-expanded'), 'false', 'aria-expanded=false da chiuso');
    assert.match(await btn.innerText(), /Dettaglio punti/i, 'il comando deve essere testuale e visibile sulla card ticker');
    const btnBox = await btn.boundingBox();
    const cardBox = await card.boundingBox();
    assert.ok(btnBox && cardBox, 'pulsante e card devono avere dimensioni visibili su mobile');
    assert.ok(btnBox.x >= cardBox.x && btnBox.x + btnBox.width <= cardBox.x + cardBox.width,
      'il pulsante deve restare interamente dentro la card a 375px');

    // Apertura da tastiera (focus + Enter sul bottone dedicato).
    await btn.focus();
    await page.keyboard.press('Enter');
    await panel.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await btn.getAttribute('aria-expanded'), 'true', 'aria-expanded=true da aperto');
    assert.equal(await card.locator('[data-testid="provenienza-panel-mobile"]').count(), 1,
      'il pannello deve essere contenuto nella card ticker colorata');
    assert.equal(await page.getByTestId('card-pista-mobile').locator('[data-testid="provenienza-panel-mobile"]').count(), 0,
      'la vecchia card bianca non deve contenere la provenienza punti');

    // Totale del pannello = totale card = 4,50 pt.
    const totale = provNum(await page.getByTestId('prov-totale-mobile').innerText());
    assert.equal(totale, 4.5, `totale pannello = 4,50 pt (letto ${totale})`);

    // Subtotali PDV: A = 1,50; B = 3,00; somma = totale card.
    const puntiA = provNum(await page.getByTestId(`prov-punti-pdv-mobile-${POS_A}`).innerText());
    const puntiB = provNum(await page.getByTestId(`prov-punti-pdv-mobile-${POS_B}`).innerText());
    const puntiNoModel = provNum(await page.getByTestId(`prov-punti-pdv-mobile-${POS_NO_MODEL}`).innerText());
    assert.equal(puntiA, 1.5, `PDV A = 1,50 pt (letto ${puntiA})`);
    assert.equal(puntiB, 3, `PDV B = 3,00 pt (letto ${puntiB})`);
    assert.equal(puntiNoModel, 0, `PDV senza modello = 0 pt (letto ${puntiNoModel})`);
    assert.ok(Math.abs((puntiA + puntiB + puntiNoModel) - totale) < 0.005, 'somma subtotali PDV = totale pannello');

    const sommaTxt = await page.getByTestId('prov-somma-mobile').innerText();
    assert.match(sommaTxt, /4,50|4\.50/, 'riga somma mostra 4,50 pt');
    assert.match(sommaTxt, /= totale card/, 'riconciliazione esplicita col totale card');

    // Fonti: categoria TIED con i pezzi per PDV.
    const catA = await page.getByTestId(`prov-cat-mobile-${POS_A}-TIED`).innerText();
    assert.match(catA, /2\s*pz/, `fonte TIED del PDV A = 2 pz (letto "${catA}")`);
    const catBTied = await page.getByTestId(`prov-cat-mobile-${POS_B}-TIED`).innerText();
    const catBUntied = await page.getByTestId(`prov-cat-mobile-${POS_B}-UNTIED`).innerText();
    assert.match(catBTied, /2\s*pz/, `fonte TIED del PDV B = 2 pz (letto "${catBTied}")`);
    assert.match(catBUntied, /2\s*pz/, `fonte UNTIED del PDV B = 2 pz (letto "${catBUntied}")`);

    // Task #490 — soglia raggiunta e moltiplicatore applicato per PDV.
    // PDV A: 1,50 pt < soglia1 (3) → "Soglia non raggiunta", nessun ×.
    // PDV B: 3,00 pt ≥ soglia1 → "Soglia S1", TIED ×2 e UNTIED ×1.
    const badgeA = page.getByTestId(`prov-soglia-pdv-mobile-${POS_A}`);
    const badgeB = page.getByTestId(`prov-soglia-pdv-mobile-${POS_B}`);
    assert.equal(await badgeA.getAttribute('data-soglia-livello'), '0',
      'PDV A sotto soglia1 → livello 0');
    assert.match(await badgeA.innerText(), /Soglia non raggiunta/i,
      'PDV A deve dichiarare la soglia non raggiunta');
    assert.doesNotMatch(await badgeA.innerText(), /×/,
      'PDV A senza soglia non deve mostrare un moltiplicatore');
    assert.equal(await badgeB.getAttribute('data-soglia-livello'), '1',
      'PDV B a 3 pt raggiunge soglia1');
    assert.match(await badgeB.innerText(), /Soglia S1/,
      'PDV B deve mostrare la soglia raggiunta');
    assert.equal(await badgeB.getAttribute('data-moltiplicatori'), '1,2',
      'moltiplicatori S1 realmente applicati ai gruppi UNTIED e TIED');
    assert.match(await badgeB.innerText(), /×\s*1.*×\s*2/,
      'PDV B deve mostrare entrambi i moltiplicatori applicati ×1 e ×2');
    assert.equal(await page.getByTestId(`prov-soglia-pdv-mobile-${POS_NO_MODEL}`).count(), 0,
      'il PDV senza modello soglie non deve mostrare alcun badge soglia/moltiplicatore');

    // Il pannello è esclusivamente una provenienza punti: niente valori
    // economici o canoni.
    const panelText = await panel.innerText();
    assert.doesNotMatch(panelText, /€|canon/i, 'il dettaglio punti non deve contenere canoni o importi in euro');
    assert.ok(panelText.includes(RS), 'anche nel calcolo per-PDV deve essere visibile la Ragione Sociale sorgente');

    // Chiusura via click sulla card ticker (zona non interattiva: i punti).
    await page.getByTestId('ticker-punti-mobile').click();
    await panel.waitFor({ state: 'detached', timeout: 10000 });
    assert.equal(await btn.getAttribute('aria-expanded'), 'false', 'aria-expanded=false dopo chiusura');

    // Riapertura via click sulla card ticker.
    await page.getByTestId('ticker-punti-mobile').click();
    await panel.waitFor({ state: 'visible', timeout: 10000 });

    // Temi scuri: contrasto WCAG misurato su titolo, subtotali e fonti del
    // pannello, sia in dark standard che in midnight-violet (Task #491).
    for (const scheme of ['standard', 'midnight-violet']) {
      await setDarkScheme(pool, session, page, scheme);
      await page.reload({ waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForFunction(
        () => document.documentElement.classList.contains('dark'),
        null, { timeout: 15000 },
      );
      await card.waitFor({ state: 'visible', timeout: 30000 });
      await btn.click();
      await panel.waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(300);
      await assertPanelContrast(page, 'mobile', `dark ${scheme}`);
    }

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

test('Provenienza punti: modalità aggregazione per RS riconcilia i subtotali RS col totale card', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'prov_rs', fullName: 'Provenienza RS Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('PRVRSA');
    const POS_B = uniq('PRVRSB');
    const RS = uniq('ProvenienzaRsAgg Srl');

    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [session.orgId, MONTH, YEAR, 'Provenienza punti RS test', JSON.stringify({
        tipologiaGara: 'gara_operatore_rs',
        modalitaInserimentoRS: 'per_rs',
        pdvList: [
          { codicePos: POS_A, nome: 'Negozio RS A', ragioneSociale: RS },
          { codicePos: POS_B, nome: 'Negozio RS B', ragioneSociale: RS },
        ],
        pistaMobileRSConfig: {
          sogliePerRS: [{
            ragioneSociale: RS,
            soglia1: 3, soglia2: 100, soglia3: 200, soglia4: 300,
            forecastTargetPunti: 10, clusterPista: 'cc_1',
          }],
        },
      })],
    );

    // Due PDV della stessa RS: 2 + 4 SIM TIED.
    for (let i = 0; i < 2; i++) {
      await insertSale(pool, session.orgId, {
        codicePos: POS_A, nomeNegozio: 'Negozio RS A', ragioneSociale: RS,
        articoli: [artMobileTied],
      });
    }
    for (let i = 0; i < 4; i++) {
      await insertSale(pool, session.orgId, {
        codicePos: POS_B, nomeNegozio: 'Negozio RS B', ragioneSociale: RS,
        articoli: [artMobileTied],
      });
    }

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle', timeout: 45000 });

    const card = page.getByTestId('ticker-pista-mobile');
    await card.waitFor({ state: 'visible', timeout: 30000 });
    const btn = page.getByTestId('btn-provenienza-mobile');
    assert.equal(await card.locator('[data-testid="btn-provenienza-mobile"]').count(), 1,
      'il pulsante desktop deve essere dentro la card ticker');
    await btn.click();
    const panel = page.getByTestId('provenienza-panel-mobile');
    await panel.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await card.locator('[data-testid="provenienza-panel-mobile"]').count(), 1,
      'il pannello desktop deve restare dentro la card ticker aperta');

    // Subtotali per RS presenti e riconciliati col totale del pannello.
    const totale = provNum(await page.getByTestId('prov-totale-mobile').innerText());
    const rsRows = page.locator('[data-testid^="prov-punti-rs-mobile-"]');
    const nRs = await rsRows.count();
    assert.ok(nRs >= 1, 'almeno una riga RS nel pannello in modalità per_rs');
    let sommaRs = 0;
    for (let i = 0; i < nRs; i++) sommaRs += provNum(await rsRows.nth(i).innerText());
    assert.ok(Math.abs(sommaRs - totale) < 0.005,
      `somma subtotali RS (${sommaRs}) = totale pannello (${totale})`);
    assert.match(await page.getByTestId('prov-somma-mobile').innerText(), /= totale card/,
      'riconciliazione esplicita col totale card in modalità RS');

    // Task #490 — in modalità per_rs la soglia/moltiplicatore è a livello RS:
    // 4,50 pt totali ≥ soglia1 (3) → "Soglia S1 ×2"; nessun badge sui PDV
    // annidati (le soglie non sono per-PDV in questa modalità).
    const rsBadges = page.locator('[data-testid^="prov-soglia-rs-mobile-"]');
    assert.equal(await rsBadges.count(), 1, 'un badge soglia per la riga RS');
    assert.equal(await rsBadges.first().getAttribute('data-soglia-livello'), '1',
      'RS a 4,50 pt raggiunge soglia1 (3)');
    assert.match(await rsBadges.first().innerText(), /Soglia S1/,
      'la riga RS mostra la soglia raggiunta');
    assert.equal(await rsBadges.first().getAttribute('data-moltiplicatori'), '2',
      'moltiplicatore tied a S1 = 2 anche in modalità RS');
    assert.match(await rsBadges.first().innerText(), /×\s*2/,
      'la riga RS mostra il moltiplicatore applicato ×2');
    assert.equal(await page.locator('[data-testid^="prov-soglia-pdv-mobile-"]').count(), 0,
      'nessun badge soglia sui PDV annidati in modalità per_rs');

    // I PDV della RS compaiono come fonti annidate con i pezzi.
    await page.getByTestId(`prov-row-pdv-mobile-${POS_A}`).waitFor({ state: 'visible', timeout: 5000 });
    await page.getByTestId(`prov-row-pdv-mobile-${POS_B}`).waitFor({ state: 'visible', timeout: 5000 });
    const catB = await page.getByTestId(`prov-cat-mobile-${POS_B}-TIED`).innerText();
    assert.match(catB, /4\s*pz/, `fonte TIED del PDV B = 4 pz (letto "${catB}")`);

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
