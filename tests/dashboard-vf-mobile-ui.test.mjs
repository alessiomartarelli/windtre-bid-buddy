import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE, uniq, jsonReq, signup, setRole, cleanupOrg, newPool,
  launchBrowser, newAuthedContext,
} from './helpers/uiTest.mjs';

const now = new Date();
const month = now.getMonth() + 1;
const year = now.getFullYear();

async function insertSale(pool, orgId, pos, rs, offer, clienteTipo) {
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        ragione_sociale, stato, totale, raw_data)
     VALUES ($1, $2, now(), $3, $4, $5, 'FINALIZZATA', '10.00', $6::jsonb)`,
    [orgId, Math.floor(Math.random() * 2_000_000_000), pos, `Negozio ${pos}`, rs,
      JSON.stringify({
        cliente: { clienteTipo },
        articoli: [{
          codice: offer.codice,
          categoria: { nome: offer.categoria },
          tipologia: { nome: offer.tipologia },
          descrizione: offer.nomeEtichetta,
          dettaglio: { canone: String(offer.canone || 0) },
        }],
      })],
  );
}

async function numberAt(page, id) {
  const text = (await page.getByTestId(id).innerText()).trim();
  if (text === '—') return 0; // La tabella punti usa un trattino per una pista senza vendite.
  const value = text.match(/-?\d+(?:[.,]\d+)?/);
  assert.ok(value, `${id}: valore numerico visibile (${text})`);
  return Number(value[0].replace(',', '.'));
}

async function rsKey(page, name, prefix) {
  const row = page.locator(`[data-testid^="${prefix}"]`).filter({ hasText: name });
  assert.equal(await row.count(), 1, `riga ${name} presente`);
  return (await row.getAttribute('data-testid')).slice(prefix.length);
}

test('Dashboard Gara VF: offerte voce alimentano SIM e punti, ricariche Fastweb no (card, RS, PDV)', async () => {
  const pool = await newPool();
  let session, browser, brandId;
  try {
    session = await signup({ prefix: 'vf_gara_mobile', fullName: 'VF Mobile Gara UI Test' });
    await setRole(pool, session.profileId, 'admin');
    const brand = await pool.query('INSERT INTO brands (name) VALUES ($1) RETURNING id', [uniq('Vodafone Fastweb')]);
    brandId = brand.rows[0].id;
    await pool.query('INSERT INTO organization_brands (organization_id, brand_id) VALUES ($1, $2)', [session.orgId, brandId]);

    const ref = await jsonReq(`${BASE}/api/bisuite-canvass-reference`, { headers: { Cookie: session.cookieHeader } });
    assert.equal(ref.status, 200);
    assert.equal(ref.body?.hasCanvassBrand, true);
    const offers = ref.body.offers;
    const smart = offers.find(o => o.categoria === 'OFFERTE VOCE' && o.tipologia === 'OFFERTE VOCE SMART PAY' && o.pista === 'PISTA MOBILE');
    const wallet = offers.find(o => o.categoria === 'OFFERTE VOCE' && o.tipologia === 'OFFERTE VOCE WALLET PAY' && o.pista === 'PISTA MOBILE');
    const recharge = offers.find(o => o.categoria === 'MOBILE FASTWEB' && o.tipologia === 'RICARICA PURA' && o.pista === 'PISTA MOBILE FASTWEB');
    assert.ok(smart && wallet && recharge, 'listino VF con entrambe le offerte voce e una ricarica Fastweb');

    const A = uniq('VFA'), B = uniq('VFB'), C = uniq('VFC');
    const RS = uniq('VF SIM Srl'), ONLY_RECHARGES = uniq('VF Ricariche Srl');
    const pdvs = [
      { codicePos: A, nome: `Negozio ${A}`, ragioneSociale: RS },
      { codicePos: B, nome: `Negozio ${B}`, ragioneSociale: RS },
      { codicePos: C, nome: `Negozio ${C}`, ragioneSociale: ONLY_RECHARGES },
    ];
    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [session.orgId, month, year, 'Gara VF Mobile UI', JSON.stringify({
        pdvList: pdvs,
        pistaMobileConfig: { sogliePerPos: pdvs.map(({ codicePos }) => ({
          posCode: codicePos, soglia1: 1, soglia2: 50, soglia3: 100, soglia4: 150,
          multiplierSoglia1: 1, multiplierSoglia2: 1.2,
          multiplierSoglia3: 1.5, multiplierSoglia4: 2,
        })) },
      })],
    );
    await insertSale(pool, session.orgId, A, RS, smart, 'FISICA');
    await insertSale(pool, session.orgId, A, RS, recharge, 'FISICA');
    await insertSale(pool, session.orgId, B, RS, wallet, 'GIURIDICA');
    await insertSale(pool, session.orgId, B, RS, recharge, 'GIURIDICA');
    await insertSale(pool, session.orgId, C, ONLY_RECHARGES, recharge, 'FISICA');

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle' });
    // La card Mobile visibile è il ticker; la vecchia card-pista-mobile
    // resta nel JSX ma è disattivata.
    await page.getByTestId('ticker-pista-mobile').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByTestId('table-pdv-pista').waitFor({ timeout: 15000 });
    assert.equal(await numberAt(page, 'ticker-punti-mobile'), 2, 'card Mobile: 2 punti dalle offerte voce, non 5 dalle ricariche');

    const rs = await rsKey(page, RS, 'row-table-rs-');
    assert.equal(await numberAt(page, `cell-table-${rs}-mobile-attuale`), 2, 'RS: punti delle due SIM');
    const emptyPointsRs = page.locator('[data-testid^="row-table-rs-"]').filter({ hasText: ONLY_RECHARGES });
    // La vista Punti può omettere una RS senza contributi o mostrarla con "—".
    if (await emptyPointsRs.count()) {
      const emptyRs = (await emptyPointsRs.getAttribute('data-testid')).slice('row-table-rs-'.length);
      assert.equal(await numberAt(page, `cell-table-${emptyRs}-mobile-attuale`), 0, 'RS con sole ricariche: zero punti');
    }
    await page.getByTestId(`row-table-rs-${rs}`).click();
    for (const [pos, expected] of [[A, 1], [B, 1]]) {
      await page.getByTestId(`row-table-pdv-${pos}`).waitFor();
      assert.equal(await numberAt(page, `cell-table-${pos}-mobile-attuale`), expected, `PDV ${pos}: punti SIM`);
    }
    assert.equal(await page.getByTestId(`row-table-pdv-${C}`).count(), 0, 'PDV con sole ricariche non crea riga punti Mobile');

    await page.getByTestId('btn-tabella-mode-pezzi').click();
    await page.getByTestId('table-pdv-pista-pezzi').waitFor();
    const pezziRs = await rsKey(page, RS, 'row-table-pezzi-rs-');
    assert.equal(await numberAt(page, `cell-pezzi-${pezziRs}-mobile-attuale`), 2, 'RS: 2 pezzi SIM');
    const emptyPiecesRs = page.locator('[data-testid^="row-table-pezzi-rs-"]').filter({ hasText: ONLY_RECHARGES });
    if (await emptyPiecesRs.count()) {
      const emptyRs = (await emptyPiecesRs.getAttribute('data-testid')).slice('row-table-pezzi-rs-'.length);
      assert.equal(await numberAt(page, `cell-pezzi-${emptyRs}-mobile-attuale`), 0, 'RS con sole ricariche: zero SIM');
      await emptyPiecesRs.click();
      if (await page.getByTestId(`row-table-pezzi-pdv-${C}`).count()) {
        assert.equal(await numberAt(page, `cell-pezzi-${C}-mobile-attuale`), 0, 'PDV con sole ricariche: zero pezzi SIM');
      }
    }
    // Il toggle vista conserva le RS espanse dalla vista Punti.
    if (await page.getByTestId(`row-table-pezzi-pdv-${A}`).count() === 0) {
      await page.getByTestId(`row-table-pezzi-rs-${pezziRs}`).click();
    }
    for (const [pos, expected] of [[A, 1], [B, 1]]) {
      assert.equal(await numberAt(page, `cell-pezzi-${pos}-mobile-attuale`), expected, `PDV ${pos}: pezzi SIM`);
    }
    assert.equal(await numberAt(page, 'cell-pezzi-totale-mobile-attuale'), 2, 'totale Mobile: solo offerte voce');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (session) await cleanupOrg(pool, session);
    if (brandId) await pool.query('DELETE FROM brands WHERE id = $1', [brandId]).catch(() => {});
    await pool.end().catch(() => {});
  }
});