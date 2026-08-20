// One-off: screenshots della Dashboard Gara Reale con skin Prisma Light
// (html[data-skin="prisma-light"]) per l'approvazione visiva. Non è un test.
import {
  BASE, uniq, signup, cleanupOrg, newPool, launchBrowser, newAuthedContext,
} from '../tests/helpers/uiTest.mjs';
import fs from 'node:fs';

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();
const DATA_VENDITA = `${YEAR}-${pad(MONTH)}-10T10:00:00.000Z`;

const ART = {
  mobile: { categoria: { nome: 'TIED CF' }, tipologia: { nome: 'VOCE EASYPAY' }, dettaglio: { canone: '10' } },
  fisso: { categoria: { nome: 'ADSL/FIBRA/FWA CF' }, tipologia: { nome: 'FIBRA FTTH CF' }, dettaglio: { canone: '25' } },
};

async function insertSale(pool, orgId, { codicePos, nomeNegozio, ragioneSociale, articoli }) {
  await pool.query(
    `INSERT INTO bisuite_sales (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio, ragione_sociale, stato, totale, raw_data)
     VALUES ($1,$2,$3,$4,$5,$6,'FINALIZZATA','10.00',$7::jsonb)`,
    [orgId, Math.floor(Math.random() * 2_000_000_000), DATA_VENDITA, codicePos, nomeNegozio, ragioneSociale,
      JSON.stringify({ cliente: { clienteTipo: 'PRIVATO' }, articoli })],
  );
}

const pool = await newPool();
const session = await signup({ prefix: 'pl_preview' });
const POS = uniq('PLPOS');
const RS = uniq('PLRS');
try {
  await pool.query(
    `INSERT INTO gara_config (organization_id, month, year, name, config) VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [session.orgId, MONTH, YEAR, 'Prisma preview', JSON.stringify({
      pdvList: [{ codicePos: POS, nome: 'Negozio Prisma', ragioneSociale: RS }],
      pistaMobileConfig: { sogliePerPos: [{ posCode: POS, soglia1: 3, soglia2: 100, soglia3: 200, soglia4: 300, multiplierSoglia1: 1, multiplierSoglia2: 1.2, multiplierSoglia3: 1.5, multiplierSoglia4: 2 }] },
      pistaFissoConfig: { sogliePerPos: [{ posCode: POS, soglia1: 2, soglia2: 50, soglia3: 100, soglia4: 150, soglia5: 200, multiplierSoglia1: 2, multiplierSoglia2: 3, multiplierSoglia3: 3.5, multiplierSoglia4: 4, multiplierSoglia5: 5 }] },
    })],
  );
  for (let i = 0; i < 4; i++) await insertSale(pool, session.orgId, { codicePos: POS, nomeNegozio: 'Negozio Prisma', ragioneSociale: RS, articoli: [ART.mobile] });
  for (let i = 0; i < 3; i++) await insertSale(pool, session.orgId, { codicePos: POS, nomeNegozio: 'Negozio Prisma', ragioneSociale: RS, articoli: [ART.fisso] });

  const browser = await launchBrowser();
  fs.mkdirSync('screenshots', { recursive: true });
  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 375, height: 812 }]]) {
    const context = await newAuthedContext(browser, session, { viewport });
    await context.addInitScript(() => {
      document.documentElement.setAttribute('data-skin', 'prisma-light');
      document.documentElement.classList.remove('dark');
      localStorage.setItem('mystoredesk-theme', 'light');
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.getByTestId('section-pista-ticker').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `screenshots/prisma-light-${label}-top.jpg`, quality: 80, type: 'jpeg' });
    // scroll alla sezione ticker
    await page.getByTestId('section-pista-ticker').scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: `screenshots/prisma-light-${label}-ticker.jpg`, quality: 80, type: 'jpeg' });
    await context.close();
  }
  await browser.close();
  console.log('done');
} finally {
  await cleanupOrg(pool, session.orgId).catch((e) => console.error('cleanup', e.message));
  await pool.end();
}
