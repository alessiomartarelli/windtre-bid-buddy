// Preview temporanea Prisma Light (Task #453): semina un'org di test con
// 3 piste attive, apre la Dashboard Gara Reale col tema "prisma-light"
// (solo localStorage, nessuna persistenza server) e salva screenshot
// desktop + mobile in screenshots/. Cleanup completo dell'org alla fine.
import {
  uniq, signup, setRole, newPool, launchBrowser, newAuthedContext, BASE,
} from '../tests/helpers/uiTest.mjs';
import fs from 'node:fs';

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const DATA_VENDITA = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-10T10:00:00.000Z`;

async function insertSale(pool, orgId, { codicePos, nomeNegozio, ragioneSociale = 'Prisma Retail Srl', articoli, cliente }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  await pool.query(
    `INSERT INTO bisuite_sales (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio, ragione_sociale, stato, raw_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [orgId, bisuiteId, DATA_VENDITA, codicePos, nomeNegozio, ragioneSociale, 'ATTIVO', JSON.stringify({ cliente, articoli })],
  );
}

const artEnergia = { categoria: { nome: 'ENERGIA W3' }, tipologia: { nome: 'ENERGIA' }, descrizione: 'OFFERTA LUCE', dettaglio: { prezzo: '0.00' } };
const artTied = { categoria: { nome: 'TIED CF' }, tipologia: { nome: 'VOCE EASYPAY' }, dettaglio: { canone: '10' } };
const artMia = { categoria: { nome: 'MIA TIED' }, tipologia: { nome: 'MIA EASYPAY STANDARD' }, dettaglio: { prezzo: '0.00' } };
const fisica = { clienteTipo: 'FISICA' };
const privato = { clienteTipo: 'PRIVATO' };

const pool = await newPool();
const session = await signup({ prefix: 'pl_prev', fullName: 'Prisma Preview' });
let browser;
try {
  await setRole(pool, session.profileId, 'admin');
  // UiPrefsSync applica le preferenze del profilo sopra il localStorage:
  // per la preview impostiamo il tema direttamente sul profilo di test.
  await pool.query(
    `UPDATE profiles
        SET ui_prefs = coalesce(ui_prefs,'{}'::jsonb)
          || '{"theme":"light","dashboardStyle":"prisma-light"}'::jsonb
      WHERE id = $1`,
    [session.profileId],
  );
  const POS1 = uniq('POS');
  const POS2 = uniq('POS');
  await pool.query(
    `INSERT INTO gara_config (organization_id, month, year, name, config) VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [session.orgId, now.getMonth() + 1, now.getFullYear(), 'Gara Prisma Preview', JSON.stringify({
      pdvList: [
        { codicePos: POS1, nome: 'Milano Duomo', ragioneSociale: 'Prisma Retail Srl', abilitaEnergia: true },
        { codicePos: POS2, nome: 'Torino Centro', ragioneSociale: 'Prisma Retail Srl', abilitaEnergia: true },
      ],
      energiaConfig: { pdvInGara: 2, targetNoMalus: 0, targetS1: 1, targetS2: 5, targetS3: 10, premio: 200 },
    })],
  );
  await insertSale(pool, session.orgId, { codicePos: POS1, nomeNegozio: 'Milano Duomo', articoli: [artEnergia], cliente: fisica });
  await insertSale(pool, session.orgId, { codicePos: POS1, nomeNegozio: 'Milano Duomo', articoli: [artTied], cliente: privato });
  await insertSale(pool, session.orgId, { codicePos: POS1, nomeNegozio: 'Milano Duomo', articoli: [artTied], cliente: privato });
  await insertSale(pool, session.orgId, { codicePos: POS2, nomeNegozio: 'Torino Centro', articoli: [artMia], cliente: privato });
  await insertSale(pool, session.orgId, { codicePos: POS2, nomeNegozio: 'Torino Centro', articoli: [artEnergia], cliente: fisica });

  fs.mkdirSync('screenshots', { recursive: true });
  browser = await launchBrowser();

  for (const [label, opts] of [
    ['desktop', { viewport: { width: 1440, height: 1000 } }],
    ['mobile', { mobile: true }],
  ]) {
    const context = await newAuthedContext(browser, session, opts);
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('mystoredesk-theme', 'light');
      localStorage.setItem('mystoredesk-dashboard-style', 'prisma-light');
    });
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle' });
    await page.getByTestId('card-kpi-actual').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `screenshots/prisma-light-${label}.png`, fullPage: false });
    await page.screenshot({ path: `screenshots/prisma-light-${label}-full.png`, fullPage: true });
    console.log(`saved screenshots/prisma-light-${label}.png`);
    await context.close();
  }
} finally {
  await browser?.close().catch(() => {});
  const { cleanupOrg } = await import('../tests/helpers/uiTest.mjs');
  await cleanupOrg(pool, session).catch((e) => console.error('cleanup:', e.message));
  await pool.end().catch(() => {});
}
