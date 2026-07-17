import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  BASE,
  uniq,
  signup,
  newPool,
  launchBrowser,
  newAuthedContext,
  cleanupOrg,
} from './helpers/uiTest.mjs';

// Test UI Playwright di regressione (Task #328, fix emerso in review del
// Task #327): importando una configurazione dal simulatore, i dati SOS
// Caring già caricati in memoria NON devono restare attivi né essere
// risalvati per sbaglio. Il fix è `setSosCaring(cfg.sosCaring || null)` in
// `handleImport` (ConfigurazioneGara.tsx): la config importata non ha
// sosCaring, quindi la card si svuota e il payload di salvataggio non
// include più la chiave.
//
// Perché serve un test UI: il bug vive interamente nel wiring React fra lo
// stato `sosCaring`, `handleImport` e `buildConfigData` — nessun test puro
// può coprirlo. Scenario:
//   1. signup admin + seed organization_config con puntiVendita (sorgente
//      dell'import "dal simulatore", senza sosCaring);
//   2. upload di un Excel SOS Caring valido -> badge visibile;
//   3. salvataggio -> gara_config.config CONTIENE sosCaring (sanity: il
//      flusso di upload+save funziona davvero);
//   4. import dal simulatore (organization_config) -> la card si svuota;
//   5. nuovo salvataggio -> il record aggiornato NON contiene più sosCaring.

// Header identico al template reale (stesso set dei test puri sos-caring).
const HEADER = [
  'AnnoMese', 'DVA', 'Cod_GaraLettera', 'Canale', 'Cod_PdV_Panel', 'AM',
  'RagioneSociale', 'AllarmiStorici', 'AllarmiActual', 'Allarmi_MTD',
  '%_Check_Allarmi_Actual_su_MTD', 'MNP_Out_su_LineeAllarmate',
  'MNP_Out_Micro_su_LineeAllarmate___Di_cui', '%_Churn', 'GA_Gara',
  'CambiPiano_TIED', 'CambiPiano_TIED_Di_cui_Micro', '%_Balance_Actual',
  '%_Balance_Forecast', 'LeveMax', '%_Leve_Utilizzate',
  'Leve_SOS_Caring_Actual', 'PercentualePR',
];

const ROW = [
  '202607', 'MASCAGNI', '800000', 'FR', '9001426892', 'AM',
  'C.M.S. SRL', 1598, 1204, 769.6, 0.49, 6, 0, 0.005,
  40, 22, 0, 0.0967741935, 0.1204629246, 130, 0.0153846154, 2, '',
];

// Costruisce in memoria un file Excel SOS Caring valido (1 riga PDV).
function buildSosCaringXlsxBuffer() {
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ROW]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Caring');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Semina organization_config con una lista puntiVendita: è la sorgente
// dell'import "dal simulatore" (source = organization_config). Nessun
// sosCaring dentro, ovviamente.
async function seedOrgConfigWithPdv(pool, orgId) {
  const config = {
    puntiVendita: [
      {
        id: 'pdv-1', codicePos: '9001426892', nome: 'PDV Test',
        ragioneSociale: 'C.M.S. SRL', tipoPosizione: 'negozio',
        canale: 'franchising', clusterMobile: 'GOLD', clusterFisso: 'SILVER',
      },
    ],
  };
  await pool.query(
    `INSERT INTO organization_config (organization_id, config, config_version)
       VALUES ($1, $2::jsonb, '2.0')
     ON CONFLICT (organization_id)
       DO UPDATE SET config = COALESCE(organization_config.config, '{}'::jsonb) || $2::jsonb,
                     updated_at = now()`,
    [orgId, JSON.stringify(config)],
  );
}

// Apre Configurazione Gara autenticata e attende lo stato stabile post-load
// (stessa strategia anti-flake della suite gara-config-weights-ui: si aspetta
// la risposta di pdv-from-sales, ultima fetch del ramo di load iniziale).
async function openPage(context) {
  const page = await context.newPage();
  const pdvFromSales = page
    .waitForResponse(
      (r) => r.url().includes('/api/gara-config/pdv-from-sales'),
      { timeout: 20000 },
    )
    .catch(() => null);
  await page.goto(`${BASE}/configurazione-gara`, { waitUntil: 'networkidle' });
  await page.getByTestId('card-sos-caring').waitFor({ state: 'visible', timeout: 20000 });
  await pdvFromSales;
  return page;
}

// Salva la configurazione corrente con nome (dialog button-save).
async function saveConfig(page, name) {
  await page.getByTestId('button-save').click();
  const nameInput = page.getByTestId('input-config-name');
  await nameInput.waitFor({ state: 'visible', timeout: 10000 });
  await nameInput.fill(name);
  await page.getByTestId('button-confirm-save').click();
  await page.getByTestId('input-config-name').waitFor({ state: 'hidden', timeout: 10000 });
}

// Ultimo record gara_config per (org, month, year): ritorna config JSONB.
async function readLatestConfig(pool, orgId, month, year) {
  const r = await pool.query(
    `SELECT config
       FROM gara_config
      WHERE organization_id = $1 AND month = $2 AND year = $3
      ORDER BY updated_at DESC
      LIMIT 1`,
    [orgId, month, year],
  );
  return r.rows[0]?.config ?? null;
}

const now = new Date();
const CUR_MONTH = now.getMonth() + 1;
const CUR_YEAR = now.getFullYear();

test('import dal simulatore svuota la card SOS Caring e il salvataggio non trascina i dati vecchi', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'sos_import_ui', fullName: 'SOS Import UI', organizationName: uniq('SosImportUI') });
  const browser = await launchBrowser();
  try {
    await seedOrgConfigWithPdv(pool, session.orgId);

    const context = await newAuthedContext(browser, session);
    const page = await openPage(context);

    // --- 1) Upload dell'Excel SOS Caring: la card mostra il badge file.
    await page.getByTestId('input-sos-caring-file').setInputFiles({
      name: 'caring-pdv.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: buildSosCaringXlsxBuffer(),
    });
    const badge = page.getByTestId('badge-sos-caring-file');
    await badge.waitFor({ state: 'visible', timeout: 15000 });
    const badgeText = await badge.textContent();
    assert.ok(badgeText?.includes('1 PDV'), `badge shows parsed rows (got ${JSON.stringify(badgeText)})`);

    // --- 2) Sanity: il salvataggio con l'Excel caricato PERSISTE sosCaring.
    await saveConfig(page, 'Con Caring');
    const withCaring = await readLatestConfig(pool, session.orgId, CUR_MONTH, CUR_YEAR);
    assert.ok(withCaring, 'gara_config saved');
    assert.ok(withCaring.sosCaring, 'sosCaring persisted after upload+save (sanity)');
    assert.equal(withCaring.sosCaring.rows?.length, 1, 'sosCaring has the parsed row');

    // --- 3) Import dal simulatore (organization_config, SENZA sosCaring):
    // la card SOS Caring deve svuotarsi (badge sparito, bottone torna a
    // "Carica file Excel").
    await page.getByTestId('button-import').click();
    const importOrgBtn = page.getByTestId('button-import-org-config');
    await importOrgBtn.waitFor({ state: 'visible', timeout: 10000 });
    const importResp = page.waitForResponse(
      (r) => r.url().includes('/api/gara-config/import-from-simulator'),
      { timeout: 15000 },
    );
    await importOrgBtn.click();
    const resp = await importResp;
    assert.equal(resp.status(), 200, 'import-from-simulator succeeded');
    await badge.waitFor({ state: 'hidden', timeout: 15000 });
    const uploadBtnText = await page.getByTestId('button-upload-sos-caring').textContent();
    assert.ok(
      uploadBtnText?.includes('Carica file Excel'),
      `upload button back to empty-state label (got ${JSON.stringify(uploadBtnText)})`,
    );

    // --- 4) Nuovo salvataggio dopo l'import: il record NON deve più
    // contenere sosCaring (i dati vecchi non vengono trascinati).
    await saveConfig(page, 'Post Import');
    const afterImport = await readLatestConfig(pool, session.orgId, CUR_MONTH, CUR_YEAR);
    assert.ok(afterImport, 'gara_config still present after re-save');
    assert.equal(
      Object.prototype.hasOwnProperty.call(afterImport, 'sosCaring'),
      false,
      'sosCaring must NOT be in the saved config after simulator import',
    );
    // L'import ha comunque portato dentro i PDV della sorgente.
    assert.equal(afterImport.pdvList?.length, 1, 'imported pdvList persisted');
    assert.equal(afterImport.pdvList?.[0]?.codicePos, '9001426892', 'imported PDV code');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
