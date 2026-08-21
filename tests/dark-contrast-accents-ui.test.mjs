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
} from './helpers/uiTest.mjs';
import { assertPageContrast } from './helpers/contrastScan.mjs';
import { ACCENT_PRESET_IDS } from '../shared/uiPrefs.ts';

// Task #484 — Contrasto scuro per OGNI accent preset in whitelist.
//
// La suite gemella dark-contrast-pages-ui copre i due schemi scuri col preset
// default (indigo). Gli accent preset di Aspetto sovrascrivono --primary,
// --ring, --accent ecc.: un preset potrebbe reintrodurre combinazioni sotto
// WCAG 4.5. Qui, in tema scuro standard, si itera su TUTTI i preset della
// whitelist condivisa (shared/uiPrefs.ts) e si scandiscono Home + una pagina
// densa (Dashboard Gara Reale con gara e vendite seminate), riportando le
// violazioni con selettore, colori e ratio come nella suite esistente.

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const CUR_YEAR = now.getFullYear();
const CUR_MONTH = now.getMonth() + 1;
const DATA_VENDITA = `${CUR_YEAR}-${pad(CUR_MONTH)}-10T10:00:00.000Z`;

async function insertSale(pool, orgId, { codicePos, articoli, cliente }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        ragione_sociale, stato, totale, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      orgId, bisuiteId, DATA_VENDITA, codicePos, 'Negozio Accent', 'RS Accent Srl',
      'ATTIVO', null, JSON.stringify({ cliente, articoli }),
    ],
  );
}

// Preferenze: DB (fonte autorevole) + localStorage (bootstrap pre-paint).
const setDarkAccent = async (pool, session, page, presetId) => {
  const accent = { type: 'preset', id: presetId };
  await pool.query(
    `UPDATE profiles
        SET ui_prefs = coalesce(ui_prefs, '{}'::jsonb) || $2::jsonb
      WHERE id = $1`,
    [session.profileId, JSON.stringify({ theme: 'dark', scheme: 'standard', accent })],
  );
  await page.evaluate((a) => {
    localStorage.setItem('mystoredesk-theme', 'dark');
    localStorage.setItem('mystoredesk-scheme', 'standard');
    localStorage.setItem('mystoredesk-accent', JSON.stringify(a));
  }, accent);
};

test('Task #484 — contrasto scuro per ogni accent preset (Home + Dashboard Gara Reale)', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'darkaccent', organizationName: uniq('Org DarkAccent') });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    // ── Seed Dashboard Gara Reale: gara del mese + vendite su 3 piste ──
    const POS = uniq('POS');
    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        session.orgId, CUR_MONTH, CUR_YEAR, 'Gara Accent 484',
        JSON.stringify({
          pdvList: [{ codicePos: POS, nome: 'Negozio Accent', ragioneSociale: 'RS Accent Srl', abilitaEnergia: true }],
          energiaConfig: { pdvInGara: 1, targetNoMalus: 0, targetS1: 1, targetS2: 5, targetS3: 10, premio: 200 },
        }),
      ],
    );
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

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await context.addInitScript(() => {
      localStorage.setItem('mystoredesk-theme', 'dark');
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    const PAGES = [
      {
        label: 'Home',
        url: `${BASE}/`,
        waitSel: '[data-testid="text-home-title"]',
      },
      {
        label: 'Dashboard Gara Reale',
        url: `${BASE}/dashboard-gara-reale`,
        waitSel: '[data-testid="card-kpi-actual"]',
      },
    ];

    assert.ok(ACCENT_PRESET_IDS.length >= 2, 'whitelist preset non vuota');
    for (const presetId of ACCENT_PRESET_IDS) {
      await setDarkAccent(pool, session, page, presetId);
      for (const p of PAGES) {
        await page.goto(p.url, { waitUntil: 'networkidle' });
        // Il preset deve essere effettivamente applicato prima della scansione.
        await page.waitForFunction(
          (id) => document.documentElement.getAttribute('data-accent') === id,
          presetId, { timeout: 15000 },
        );
        await assertPageContrast(page, `accent=${presetId} / ${p.label}`, { waitSel: p.waitSel });
      }
    }

    await context.close();
  } finally {
    if (browser) await browser.close();
    await cleanupOrg(pool, session);
    await pool.end();
  }
});
