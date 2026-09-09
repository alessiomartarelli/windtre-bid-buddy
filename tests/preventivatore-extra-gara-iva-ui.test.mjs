import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  jsonReq,
  signup,
  newPool,
  launchBrowser,
  newAuthedContext,
  cleanupOrg,
} from './helpers/uiTest.mjs';

const now = new Date();
const RS = 'LINEE IVA TEST SRL';
const PDV_ID = 'pdv-extra-iva';

function authed(session, opts = {}) {
  return { ...opts, headers: { Cookie: session.cookieHeader, ...(opts.headers || {}) } };
}

const flat = (value) => value.replace(/[\s\u00a0]/g, '');

test('Preventivatore: il riepilogo Extra IVA separa le due linee e mostra FRITZ una sola volta', async () => {
  const pool = await newPool();
  const session = await signup({
    prefix: 'prev_extra_iva_ui',
    fullName: 'Preventivatore Extra IVA UI',
  });
  let browser;

  try {
    const preventivoData = {
      // gara_operatore non ha lo step di selezione modalità: Extra IVA è 12.
      step: 12,
      configGara: {
        nomeGara: 'Riepilogo linee IVA',
        haLetteraUfficiale: false,
        annoGara: now.getFullYear(),
        meseGara: now.getMonth() + 1,
        tipoPeriodo: 'mensile',
        tipologiaGara: 'gara_operatore',
      },
      numeroPdv: 1,
      puntiVendita: [{
        id: PDV_ID,
        codicePos: 'POS-EXTRA-IVA',
        nome: 'Negozio Extra IVA',
        ragioneSociale: RS,
        tipoPosizione: 'negozio',
        canale: 'strada',
        clusterMobile: 'C1',
        clusterFisso: 'C1',
        clusterCB: 'C1',
        clusterPIva: 'business_promoter',
        abilitaEnergia: false,
        abilitaAssicurazioni: false,
        calendar: {
          weeklySchedule: { workingDays: [1, 2, 3, 4, 5, 6] },
          specialDays: [],
        },
      }],
      modalitaInserimentoRS: 'per_pdv',
      attivatoFissoByPos: {
        [PDV_ID]: [
          { categoria: 'FISSO_PIVA_1A_LINEA', pezzi: 2 },
          { categoria: 'FISSO_PIVA_2A_LINEA', pezzi: 3 },
          { categoria: 'FRITZ_BOX', pezzi: 5 },
        ],
      },
    };

    const created = await jsonReq(`${BASE}/api/preventivi`, authed(session, {
      method: 'POST',
      body: JSON.stringify({ name: 'Riepilogo linee IVA', data: preventivoData }),
    }));
    assert.equal(created.status, 201, JSON.stringify(created.body));

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/preventivatore?id=${created.body.id}`, { waitUntil: 'networkidle' });

    const primaLinea = page.getByTestId(`extra-iva-prima-linea-${RS}`);
    const secondaLinea = page.getByTestId(`extra-iva-seconda-linea-${RS}`);
    const fritz = page.getByTestId(`extra-iva-fritz-${RS}`);
    await primaLinea.waitFor({ state: 'visible', timeout: 30000 });

    assert.equal(flat(await primaLinea.innerText()), 'FissoP.IVA1ªLinea2pz·2pt');
    assert.equal(flat(await secondaLinea.innerText()), 'FissoP.IVA2ªLinea3pz·3pt');
    assert.equal(flat(await fritz.innerText()), 'FRITZ!Box5pz·2,5pt');
    assert.equal(
      await page.getByText('FRITZ!Box', { exact: true }).count(),
      1,
      'FRITZ compare una sola volta come voce separata',
    );

    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});