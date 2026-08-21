import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  uniq,
  jsonReq,
  signup,
  setRole,
  cleanupOrg,
  newPool,
  launchBrowser,
  newAuthedContext,
  seedJourney,
} from './helpers/uiTest.mjs';

// Task #482 — Contrasto scuro sulle pagine operative con dati reali.
//
// La suite gemella tests/dark-contrast-ui.test.mjs verifica il contrasto su
// una sonda iniettata in home. Qui invece si seminano dati veri via pg/API e
// si scandiscono TRE pagine dense — Dashboard Gara Reale, Controllo di
// Gestione (Amministrazione#controllo) e Customer Journey — nei due schemi
// scuri (standard e Midnight Violet), verificando che OGNI testo visibile
// (KPI, tabelle, filtri, badge) rispetti WCAG:
//   - contrasto >= 4.5 per testo normale;
//   - contrasto >= 3.0 per testo grande (>=24px, o >=18.5px bold).
// Così si intercettano combinazioni di colori hard-coded future che la sonda
// generica non copre.

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const CUR_YEAR = now.getFullYear();
const CUR_MONTH = now.getMonth() + 1;
const YM = `${CUR_YEAR}-${pad(CUR_MONTH)}`;
const DATA_VENDITA = `${CUR_YEAR}-${pad(CUR_MONTH)}-10T10:00:00.000Z`;

const api = (session, method, path, body) =>
  jsonReq(`${BASE}${path}`, {
    method,
    headers: { Cookie: session.cookieHeader },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

// ── Seed helpers (stessa forma dei test dashboard-gara / cdg) ─────────────
async function insertSale(pool, orgId, { codicePos, articoli, cliente }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        ragione_sociale, stato, totale, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      orgId, bisuiteId, DATA_VENDITA, codicePos, 'Negozio Contrasto', 'RS Contrasto Srl',
      'ATTIVO', null, JSON.stringify({ cliente, articoli }),
    ],
  );
}

async function insertGaraConfig(pool, orgId, config) {
  await pool.query(
    `INSERT INTO gara_config (organization_id, month, year, name, config)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [orgId, CUR_MONTH, CUR_YEAR, 'Gara Contrasto 482', JSON.stringify(config)],
  );
}

// ── Preferenze tema: DB (fonte autorevole) + localStorage (bootstrap) ─────
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

// ── Scanner contrasto in-page ─────────────────────────────────────────────
// Percorre tutti gli elementi con testo diretto visibile dentro `rootSel` e
// calcola il rapporto di contrasto WCAG fra colore testo (composto con
// l'opacità effettiva) e sfondo effettivo (fusione degli sfondi
// semi-trasparenti degli antenati). Ritorna le violazioni.
// Esclusioni prudenti (non verificabili o legittime per WCAG):
//   - elementi disabilitati (disabled / aria-disabled);
//   - antenati con background-image (gradienti: sfondo non calcolabile);
//   - testo trasparente (decorativo, es. background-clip:text).
const scanContrast = (page, rootSel) =>
  page.evaluate((sel) => {
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

    const root = document.querySelector(sel);
    if (!root) return { missingRoot: true, violations: [] };

    const violations = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let el = root; el; el = walker.nextNode()) {
      if (!(el instanceof HTMLElement)) continue;
      // Solo elementi con testo DIRETTO non vuoto.
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

      // Disabilitato = esenzione WCAG.
      if (el.closest('[disabled], [aria-disabled="true"], [data-disabled]')) continue;

      // Opacità effettiva (prodotto degli antenati) composta nel colore testo.
      let opacity = 1;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        opacity *= Number(getComputedStyle(n).opacity || 1);
      }
      const fgRaw = parse(cs.color);
      if (!fgRaw) continue;
      let fg = { ...fgRaw, a: fgRaw.a * opacity };
      if (fg.a <= 0.01) continue; // testo trasparente/decorativo

      // Sfondo effettivo: fusione risalendo gli antenati.
      let bg = null;
      let unknown = false;
      let node = el;
      const chain = [];
      while (node) {
        chain.push(node);
        node = node.parentElement;
        if (!node && chain[chain.length - 1] !== document.documentElement) {
          chain.push(document.body, document.documentElement);
          break;
        }
      }
      for (const n of chain) {
        if (!n) continue;
        const ncs = getComputedStyle(n);
        const c = parse(ncs.backgroundColor);
        if (ncs.backgroundImage && ncs.backgroundImage !== 'none') {
          // Gradiente/immagine: sfondo non calcolabile in modo affidabile.
          if (!bg || bg.a < 1) unknown = true;
          break;
        }
        if (c && c.a > 0) {
          bg = bg ? blendOver(bg, c) : c;
          if (bg.a >= 0.999) break;
        }
      }
      if (unknown || !bg) continue;
      if (bg.a < 0.999) bg = blendOver(bg, { r: 255, g: 255, b: 255, a: 1 });

      // Testo semi-trasparente: componilo sopra lo sfondo.
      if (fg.a < 1) fg = blendOver(fg, bg);

      const size = parseFloat(cs.fontSize) || 16;
      const weight = Number(cs.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.5 && weight >= 700);
      const min = large ? 3.0 : 4.5;
      const r = ratio(fg, bg);
      if (r < min) {
        violations.push({
          ratio: Number(r.toFixed(2)),
          min,
          text: direct.slice(0, 60),
          testid: el.closest('[data-testid]')?.getAttribute('data-testid') || null,
          tag: el.tagName.toLowerCase(),
          cls: (el.className && String(el.className).slice(0, 120)) || '',
          fg: `rgb(${Math.round(fg.r)},${Math.round(fg.g)},${Math.round(fg.b)})`,
          bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        });
      }
    }
    return { missingRoot: false, violations };
  }, rootSel);

const assertPageContrast = async (page, label, { rootSel = 'main, body', waitSel }) => {
  await page.waitForFunction(
    () => document.documentElement.classList.contains('dark'),
    null, { timeout: 15000 },
  );
  if (waitSel) await page.locator(waitSel).first().waitFor({ state: 'visible', timeout: 30000 });
  // Piccola attesa per render post-fetch (grafici/tabelle virtualizzate).
  await page.waitForTimeout(500);

  const root = (await page.locator('main').count()) ? 'main' : 'body';
  const { violations } = await scanContrast(page, rootSel === 'main, body' ? root : rootSel);
  assert.equal(
    violations.length,
    0,
    `${label}: ${violations.length} violazioni di contrasto:\n` +
      violations
        .map((v) => `  - [${v.testid ?? v.tag}] "${v.text}" ratio=${v.ratio} (min ${v.min}) fg=${v.fg} bg=${v.bg} cls="${v.cls}"`)
        .join('\n'),
  );
};

test('Task #482 — contrasto scuro su Dashboard Gara, CdG e Customer Journey con dati reali', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'darkpages', organizationName: uniq('Org DarkPages') });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    // ── Seed Dashboard Gara Reale: gara del mese + vendite su 3 piste ──
    const POS = uniq('POS');
    await insertGaraConfig(pool, session.orgId, {
      pdvList: [{ codicePos: POS, nome: 'Negozio Contrasto', ragioneSociale: 'RS Contrasto Srl', abilitaEnergia: true }],
      energiaConfig: { pdvInGara: 1, targetNoMalus: 0, targetS1: 1, targetS2: 5, targetS3: 10, premio: 200 },
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS,
      articoli: [{ categoria: { nome: 'ENERGIA W3' }, tipologia: { nome: 'ENERGIA' }, descrizione: 'OFFERTA LUCE', dettaglio: { prezzo: '0.00' } }],
      cliente: { clienteTipo: 'FISICA' },
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS,
      articoli: [{ categoria: { nome: 'TIED CF' }, tipologia: { nome: 'VOCE EASYPAY' }, dettaglio: { canone: '10' } }],
      cliente: { clienteTipo: 'PRIVATO' },
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS,
      articoli: [{ categoria: { nome: 'MIA TIED' }, tipologia: { nome: 'MIA EASYPAY STANDARD' }, dettaglio: { prezzo: '0.00' } }],
      cliente: { clienteTipo: 'PRIVATO' },
    });

    // ── Seed Controllo di Gestione: RS + categoria + spese nel mese ──
    const rs = uniq('RS CdG 482');
    const createRs = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: rs });
    assert.equal(createRs.status, 201, `create RS: ${JSON.stringify(createRs.body)}`);
    const cat = await api(session, 'POST', '/api/cdg/categorie', {
      nome: uniq('Cat Contrasto'), ragioniSociali: [rs],
    });
    assert.equal(cat.status, 201, `create cat: ${JSON.stringify(cat.body)}`);
    for (const [i, imp] of [['A', '120.00'], ['B', '75.50'], ['C', '310.00']]) {
      const r = await api(session, 'POST', '/api/cdg/spese', {
        ragioneSociale: rs,
        descrizione: `Spesa contrasto ${i}`,
        categoriaId: cat.body.id,
        imponibile: imp,
        aliquotaIva: '22.00',
        dataPagamento: `${YM}-05`,
        meseCompetenza: YM,
        ricorrente: false,
      });
      assert.equal(r.status, 201, `create spesa ${i}: ${JSON.stringify(r.body)}`);
    }

    // ── Seed Customer Journey: journey con item su più driver/stati ──
    const journeyId = await seedJourney(pool, session.orgId, {
      customerKey: uniq('CF'),
      nome: 'Cliente Contrasto',
      addetto: 'Addetto Contrasto',
      pdv: 'Negozio Contrasto',
      items: [
        { driver: 'mobile', state: 'attivato', importo: '9.99' },
        { driver: 'fisso', state: 'inserito' },
        { driver: 'energia', state: 'ko', importo: '0' },
      ],
    });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    // Bootstrap dark già alla prima navigazione.
    await context.addInitScript(() => {
      localStorage.setItem('mystoredesk-theme', 'dark');
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    const PAGES = [
      {
        label: 'Dashboard Gara Reale',
        url: `${BASE}/dashboard-gara-reale`,
        waitSel: '[data-testid="card-kpi-actual"]',
      },
      {
        label: 'Controllo di Gestione',
        url: `${BASE}/amministrazione#controllo`,
        waitSel: '[data-testid="row-summary-0"]',
      },
      {
        label: 'Customer Journey',
        url: `${BASE}/customer-journey`,
        waitSel: `[data-testid="card-journey-${journeyId}"]`,
      },
    ];

    for (const scheme of ['standard', 'midnight-violet']) {
      await setDarkScheme(pool, session, page, scheme);
      for (const p of PAGES) {
        await page.goto(p.url, { waitUntil: 'networkidle' });
        await assertPageContrast(page, `${scheme} / ${p.label}`, { waitSel: p.waitSel });
      }
    }

    await context.close();
  } finally {
    if (browser) await browser.close();
    await cleanupOrg(pool, session);
    await pool.end();
  }
});
