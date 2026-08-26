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
import { calcolaPuntiComponentePista } from '../client/src/lib/provenienzaPunti.ts';

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

const artMobileTiedConStepETelefono = {
  ...artMobileTied,
  dettaglio: {
    ...artMobileTied.dettaglio,
    domandeRisposte: [
      { domandaTesto: 'MNP', risposta: 'SI' },
      { domandaTesto: 'TELEFONO INCLUSO COMPASS', risposta: 'SI' },
    ],
  },
}; // TIED 0,75 + step MNP 1,20 + device finanziato 1,25

const artMobileUntied = {
  categoria: { nome: 'UNTIED' },
  tipologia: { nome: 'RICARICABILE VOCE' },
  dettaglio: { canone: '10' },
}; // mobile → UNTIED (0,75 punti)

const artFissoFtth = {
  categoria: { nome: 'ADSL/FIBRA/FWA CF' },
  tipologia: { nome: 'FIBRA FTTH CF' },
  dettaglio: { canone: '25' },
}; // fisso → FISSO_FTTH (1 punto per pezzo)

const artPartnershipConTelefonoFinanziato = {
  categoria: { nome: 'MIA TIED' },
  tipologia: { nome: 'MIA EASYPAY STANDARD' },
  dettaglio: {
    canone: '10',
    domandeRisposte: [
      { domandaTesto: 'MIA TELEFONO FINANZIAMENTO', risposta: '10' },
    ],
  },
}; // Partnership Reward: rivincolo 4 pt + telefono finanziato 8 pt

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
const componentPoints = (txt) => {
  const match = String(txt).match(/·\s*([+-]?[\d.]+(?:,\d+)?)\s*pt/i);
  return match ? Number(match[1].replace(/\./g, '').replace(',', '.')) : NaN;
};

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
  assert.ok(hasTestid(`prov-cat-${pista}-`) || hasTestid(`prov-cat-rs-${pista}-`),
    `${label}: fonti (categorie) misurate`);
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

test('Provenienza punti: ogni pista calcola i punti delle componenti col proprio modello', () => {
  const context = {
    mobile: { TIED: 0.75 },
    partnership: { cambio_offerta_rivincoli: 6 },
    assicurazioni: { protezionePro: 5 },
    extraGara: { worldStaff: 2 },
  };

  assert.equal(calcolaPuntiComponentePista('mobile', 'TIED', 4, context), 3);

  // Stesso caso segnalato nel pannello Fisso: anche i coefficienti frazionari
  // e le categorie a zero devono essere visibili, senza stime proporzionali.
  assert.equal(calcolaPuntiComponentePista('fisso', 'FISSO_FTTH', 145, context), 145);
  assert.equal(
    calcolaPuntiComponentePista('fisso', 'FISSO_FTTH', 145, { ...context, fisso: { FISSO_FTTH: 2 } }),
    290,
    'la provenienza Fisso usa l’override configurato dei punti/pezzo',
  );
  assert.equal(calcolaPuntiComponentePista('fisso', 'PIU_SICURI_CASA_UFFICIO', 277, context), 69.25);
  assert.equal(calcolaPuntiComponentePista('fisso', 'CONVERGENZA', 197, context), 0);

  assert.equal(calcolaPuntiComponentePista('energia', 'BUSINESS_CON_SDD', 7, context), 7);
  assert.equal(calcolaPuntiComponentePista('partnership', 'cambio_offerta_rivincoli', 3, context), 18);
  assert.equal(calcolaPuntiComponentePista('partnership', 'buy_untied', 3), 6);
  assert.equal(calcolaPuntiComponentePista('partnership', 'IMP_AGG_0_VAR_FINANZ', 1), 6);
  assert.equal(calcolaPuntiComponentePista('partnership', 'IMP_AGG_GT0_FINANZ', 1), 8);
  assert.equal(calcolaPuntiComponentePista('partnership', 'IMP_AGG_GT0_VAR', 1), 6);
  assert.equal(calcolaPuntiComponentePista('cb', 'cambio_offerta_rivincoli', 8, context), 8);
  assert.equal(calcolaPuntiComponentePista('cb', 'coupon_caring', 8, context), 0);
  assert.equal(calcolaPuntiComponentePista('assicurazioni', 'protezionePro', 2, context), 10);
  assert.equal(calcolaPuntiComponentePista('assicurazioni', 'pagamentoAnnuale', 3), 1.5);
  assert.equal(calcolaPuntiComponentePista('protecta', 'casaStart', 2, context), 2);
  assert.equal(calcolaPuntiComponentePista('extra_gara_iva', 'worldStaff', 2, context), 4);
  assert.equal(calcolaPuntiComponentePista('extra_gara_iva', 'fullPlus', 3), 3);
  assert.equal(calcolaPuntiComponentePista('fisso', 'CATEGORIA_SCONOSCIUTA', 99, context), 0);
});

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

  const fissoConPuntiOverride = calcolaPremioPistaFissoPerPos({
    ...common,
    attivato: [{ categoria: 'FISSO_FTTC', pezzi: 2 }],
    puntiPerPezzoOverride: { FISSO_FTTC: 1.5 },
  });
  assert.equal(fissoConPuntiOverride.punti, 3,
    'il calcolatore Fisso usa l’override configurato dei punti/pezzo');

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
        pistaFissoConfig: {
          sogliePerPos: [POS_A, POS_B].map((posCode) => ({
            posCode,
            soglia1: 2, soglia2: 100, soglia3: 200, soglia4: 300, soglia5: 400,
            multiplierSoglia1: 1, multiplierSoglia2: 1.5,
            multiplierSoglia3: 2, multiplierSoglia4: 3, multiplierSoglia5: 4,
          })),
        },
      })],
    );

    // PDV A: 2 TIED + uno step MNP + un device finanziato = 3,95 pt.
    // PDV B: 2 TIED + 2 UNTIED = 3,00 pt. Totale = 6,95 pt.
    for (let i = 0; i < 2; i++) {
      await insertSale(pool, session.orgId, {
        codicePos: POS_A, nomeNegozio: 'Negozio Prov A', ragioneSociale: RS,
        articoli: [i === 0 ? artMobileTiedConStepETelefono : artMobileTied],
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
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio Prov A', ragioneSociale: RS,
      articoli: [artFissoFtth, artFissoFtth],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio Prov A', ragioneSociale: RS,
      articoli: [artPartnershipConTelefonoFinanziato],
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

    // Totale del pannello = totale card = 6,95 pt.
    const totale = provNum(await page.getByTestId('prov-totale-mobile').innerText());
    assert.equal(totale, 6.95, `totale pannello = 6,95 pt (letto ${totale})`);

    // Con "Tutti i PDV" il dettaglio è aggregato per RS: una sola riga,
    // con pezzi e punti totali, senza elenco dei singoli negozi.
    const rsPoints = page.locator('[data-testid^="prov-punti-rs-mobile-"]');
    const rsPieces = page.locator('[data-testid^="prov-pezzi-rs-mobile-"]');
    assert.equal(await rsPoints.count(), 1, 'una sola riga totale per la RS filtrata/scoped');
    assert.equal(await rsPieces.count(), 1, 'la riga RS espone anche il totale pezzi');
    assert.equal(provNum(await rsPoints.first().innerText()), 6.95, 'totale RS = 6,95 pt');
    assert.equal(provNum(await rsPieces.first().innerText()), 7, 'totale RS = 7 pezzi');
    assert.equal(await page.locator('[data-testid^="prov-row-pdv-mobile-"]').count(), 0,
      'con Tutti i PDV non deve comparire il dettaglio dei singoli negozi');

    const sommaTxt = await page.getByTestId('prov-somma-mobile').innerText();
    assert.match(sommaTxt, /6,95|6\.95/, 'riga somma mostra 6,95 pt');
    assert.match(sommaTxt, /= totale card/, 'riconciliazione esplicita col totale card');

    // Fonti aggregate per RS: i pezzi del PDV senza modello restano visibili,
    // ma valgono 0 punti come nella card. Quindi TIED 5 pezzi = 3,00 pt.
    const rsCategoryText = await page.locator('[data-testid^="prov-cat-rs-mobile-"]').allInnerTexts();
    assert.ok(rsCategoryText.some((text) => /Tied/i.test(text) && /5\s*pz/.test(text) && /3,00\s*pt|3\.00\s*pt/.test(text)),
      `TIED aggregato RS = 5 pz / 3,00 pt (${rsCategoryText.join(' | ')})`);
    assert.ok(rsCategoryText.some((text) => /Untied/i.test(text) && /2\s*pz/.test(text) && /1,50\s*pt|1\.50\s*pt/.test(text)),
      `UNTIED aggregato RS = 2 pz / 1,50 pt (${rsCategoryText.join(' | ')})`);
    assert.ok(rsCategoryText.some((text) => /^MNP\b/i.test(text) && /1\s*pz/.test(text) && /1,20\s*pt|1\.20\s*pt/.test(text)),
      `step vendita MNP = 1 pz / 1,20 pt (${rsCategoryText.join(' | ')})`);
    assert.ok(rsCategoryText.some((text) => /Device finanziato/i.test(text) && /1\s*pz/.test(text) && /1,25\s*pt|1\.25\s*pt/.test(text)),
      `telefono finanziato = 1 pz / 1,25 pt (${rsCategoryText.join(' | ')})`);
    assert.equal(
      rsCategoryText.reduce((sum, text) => sum + componentPoints(text), 0),
      totale,
      'la somma dei punti delle categorie Mobile deve riconciliare il totale card',
    );

    const partnershipBtn = page.getByTestId('btn-provenienza-partnership');
    await partnershipBtn.click();
    const partnershipPanel = page.getByTestId('provenienza-panel-partnership');
    await partnershipPanel.waitFor({ state: 'visible', timeout: 10000 });
    assert.match(
      await page.getByTestId('ticker-pista-partnership').innerText(),
      /Partnership Reward/i,
      'la pista usa il nome corretto Partnership Reward',
    );
    assert.equal(
      provNum(await page.getByTestId('prov-totale-partnership').innerText()),
      12,
      'Partnership Reward include 4 pt del rivincolo + 8 pt del telefono CB',
    );
    const partnershipCategories = await page.locator('[data-testid^="prov-cat-rs-partnership-"]').allInnerTexts();
    assert.ok(
      partnershipCategories.some((text) => /IMP\.AGG>0 FINANZ/i.test(text) && /1\s*pz/.test(text) && /8,00\s*pt|8\.00\s*pt/.test(text)),
      `la provenienza mostra il telefono CB finanziato da 8 pt (${partnershipCategories.join(' | ')})`,
    );
    await btn.click();
    await panel.waitFor({ state: 'visible', timeout: 10000 });

    // Task #490 — soglia raggiunta e moltiplicatore applicato per PDV.
    // PDV A: 1,50 pt < soglia1 (3) → "Soglia non raggiunta", nessun ×.
    // PDV B: 3,00 pt ≥ soglia1 → "Soglia S1", TIED ×2 e UNTIED ×1.
    assert.equal(await page.locator('[data-testid^="prov-soglia-pdv-mobile-"]').count(), 0,
      'il totale RS non deve mostrare badge soglia dei singoli PDV');

    // Il pannello è esclusivamente una provenienza punti: niente valori
    // economici o canoni. Il simbolo € può comparire nel nome ufficiale della
    // categoria device (es. "SP < 200€"), ma non come valore autonomo.
    const panelText = await panel.innerText();
    assert.doesNotMatch(panelText, /canon|(?:^|\n)\s*€/i, 'il dettaglio punti non deve contenere canoni o importi in euro');
    assert.ok(panelText.includes(RS), 'anche nel calcolo per-PDV deve essere visibile la Ragione Sociale sorgente');

    // Chiusura via click sulla card ticker (zona non interattiva: i punti).
    await page.getByTestId('ticker-punti-mobile').click();
    await panel.waitFor({ state: 'detached', timeout: 10000 });
    assert.equal(await btn.getAttribute('aria-expanded'), 'false', 'aria-expanded=false dopo chiusura');

    // La stessa UI espone i punti anche per le piste non Mobile.
    const fissoPanel = page.getByTestId('provenienza-panel-fisso');
    await page.getByTestId('btn-provenienza-fisso').click();
    await fissoPanel.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(provNum(await page.getByTestId('prov-totale-fisso').innerText()), 2,
      'totale Fisso = 2 FTTH × 1 punto');
    const fissoCategoryText = await page.locator('[data-testid^="prov-cat-rs-fisso-"]').allInnerTexts();
    assert.ok(
      fissoCategoryText.some((text) => /FTTH/i.test(text) && /2\s*pz/.test(text) && /2,00\s*pt|2\.00\s*pt/.test(text)),
      `Fisso FTTH espone pezzi e punti (${fissoCategoryText.join(' | ')})`,
    );
    assert.ok(
      fissoCategoryText.every((text) => /\d+\s*pz\s*·\s*[\d,.]+\s*pt/.test(text)),
      `ogni componente Fisso usa il formato pezzi · punti (${fissoCategoryText.join(' | ')})`,
    );
    assert.equal(
      fissoCategoryText.reduce((sum, text) => sum + componentPoints(text), 0),
      2,
      'la somma dei punti delle categorie Fisso deve riconciliare il totale card',
    );
    await page.getByTestId('ticker-punti-fisso').click();
    await fissoPanel.waitFor({ state: 'detached', timeout: 10000 });

    // Anche la tabella di dettaglio PDV, non solo il pannello Provenienza,
    // deve esporre i punti Fisso riconciliati con la card.
    const pdvAccordion = page.getByTestId(`pdv-accordion-${POS_A}`);
    await pdvAccordion.locator('[data-radix-collection-item]').click();
    const fissoTableCategory = page.getByTestId(`pdv-pista-category-${POS_A}-fisso-FISSO_FTTH`);
    await fissoTableCategory.waitFor({ state: 'visible', timeout: 10000 });
    assert.match(
      await fissoTableCategory.innerText(),
      /2\s*pz\s*·\s*(?:2,00|2\.00)\s*pt/,
      'la tabella PDV Fisso mostra pezzi e punti per categoria',
    );

    // Riapertura Mobile via click sulla card ticker.
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
      if (scheme === 'midnight-violet' && process.env.PROVENIENZA_SCREENSHOT_PATH) {
        await page.getByTestId('ticker-punti-mobile').click();
        await panel.waitFor({ state: 'detached', timeout: 10000 });
        await page.getByTestId('btn-provenienza-fisso').click();
        await fissoPanel.waitFor({ state: 'visible', timeout: 10000 });
        await fissoPanel.screenshot({ path: process.env.PROVENIENZA_SCREENSHOT_PATH });
      }
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

    // Anche in modalità per-RS i negozi non sono elencati con "Tutti i PDV":
    // il totale espone pezzi, punti e categorie già aggregati.
    assert.equal(await page.locator('[data-testid^="prov-row-pdv-mobile-"]').count(), 0,
      'nessun PDV annidato nel totale RS');
    assert.equal(provNum(await page.locator('[data-testid^="prov-pezzi-rs-mobile-"]').first().innerText()), 6,
      'totale RS = 6 pezzi');
    const rsCat = await page.locator('[data-testid^="prov-cat-rs-mobile-"]').allInnerTexts();
    assert.ok(rsCat.some((text) => /Tied/i.test(text) && /6\s*pz/.test(text) && /4,50\s*pt|4\.50\s*pt/.test(text)),
      `fonte TIED aggregata RS = 6 pz / 4,50 pt (${rsCat.join(' | ')})`);

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
