// Shared helpers for Customer Journey UI / DB-backed test suites.
//
// Estrae il boilerplate che prima viveva inline nei singoli test:
//   - risoluzione del path di chromium di sistema + launch del browser
//     headless con gli args standard (Playwright via playwright-core);
//   - signup HTTP + estrazione del cookie di sessione (sia in forma
//     {name,value} per Playwright, sia come header "Cookie" per fetch);
//   - pool pg condiviso + helper di seed/cleanup (journey + item) e
//     mutazione del ruolo/addetti del profilo.
//
// Obiettivo: i nuovi test UI restano corti e consistenti. NON contiene
// logica di business — solo infrastruttura di test.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

export const BASE = process.env.FINPLAN_BASE_URL || 'http://localhost:5000';

// Suffisso univoco per evitare collisioni fra run paralleli/ripetuti.
export function uniq(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

// fetch JSON con parsing tollerante (json o testo) e ritorno uniforme.
export async function jsonReq(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  let body = null;
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) body = await r.json().catch(() => null);
  else body = await r.text().catch(() => null);
  return { status: r.status, headers: r.headers, body };
}

// Tutti i cookie name=value di Set-Cookie uniti come header "Cookie".
export function pickCookieHeader(headers) {
  const sc = headers.getSetCookie?.() || headers.raw?.()['set-cookie'] || [];
  const arr = Array.isArray(sc) ? sc : [sc];
  return arr
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

// Prima coppia {name, value} dei cookie di sessione (per Playwright addCookies).
export function pickSessionCookie(headers) {
  const sc = headers.getSetCookie?.() || headers.raw?.()['set-cookie'] || [];
  const arr = Array.isArray(sc) ? sc : [sc];
  const first = arr.map((c) => c.split(';')[0]).filter(Boolean)[0];
  assert.ok(first, 'no session cookie returned by signup');
  const eq = first.indexOf('=');
  return { name: first.slice(0, eq), value: first.slice(eq + 1) };
}

// Crea un profilo admin + org via /api/auth/signup. Ritorna gli id e il
// cookie sia in forma oggetto (Playwright) sia come header (fetch).
export async function signup({ prefix = 'ui_test', fullName = 'UI Test', organizationName } = {}) {
  const email = `${uniq(prefix)}@example.com`;
  const password = 'Pa55word!';
  const orgName = organizationName || uniq('UITestOrg');
  const r = await jsonReq(`${BASE}/api/auth/signup`, {
    method: 'POST',
    body: JSON.stringify({ email, password, fullName, organizationName: orgName }),
  });
  assert.equal(r.status, 201, `signup failed: ${JSON.stringify(r.body)}`);
  const cookie = pickSessionCookie(r.headers);
  const cookieHeader = pickCookieHeader(r.headers);
  const profileId = r.body?.id;
  const orgId = r.body?.organization?.id || r.body?.organizationId;
  assert.ok(profileId && orgId, `missing ids in signup response: ${JSON.stringify(r.body)}`);
  return { email, password, cookie, cookieHeader, profileId, orgId };
}

// Pool pg condiviso sul dev DB. Richiede DATABASE_URL.
export async function newPool() {
  const pgMod = await import('pg');
  const Pool = pgMod.default?.Pool || pgMod.Pool;
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for this test');
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

// Path dell'eseguibile chromium di sistema (Nix). Override via CHROMIUM_PATH.
export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const out = execSync('which chromium-browser || which chromium', { encoding: 'utf8' }).trim();
  assert.ok(out, 'chromium executable not found on PATH');
  return out;
}

// ---------------------------------------------------------------------------
// Semaforo cross-process per i browser Chromium.
//
// La validazione di completamento lancia ~36 suite in parallelo: troppe
// istanze Chromium simultanee esauriscono i thread del container
// ("pthread_create: Resource temporarily unavailable") e suite a caso
// falliscono al launch pur passando se rieseguite da sole. Il semaforo
// limita i browser vivi in contemporanea su TUTTA la macchina usando
// directory-lock atomiche in /tmp (mkdir è atomico anche fra processi).
// Ogni slot contiene un file "pid": slot di processi morti o più vecchi
// di UI_BROWSER_SLOT_STALE_MS vengono reclamati (crash senza cleanup).
// ---------------------------------------------------------------------------
const SLOT_ROOT = process.env.UI_BROWSER_SLOT_DIR || '/tmp/ui-browser-slots';
const MAX_SLOTS = Math.max(1, Number(process.env.UI_BROWSER_SLOTS) || 3);
const SLOT_STALE_MS = Math.max(30_000, Number(process.env.UI_BROWSER_SLOT_STALE_MS) || 180_000);
const SLOT_WAIT_TIMEOUT_MS = Math.max(60_000, Number(process.env.UI_BROWSER_SLOT_TIMEOUT_MS) || 600_000);

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = esiste ma non nostro (in sandbox non capita); trattalo come vivo.
    return err.code === 'EPERM';
  }
}

async function tryClaimSlot(fs, path, i) {
  const dir = path.join(SLOT_ROOT, `slot-${i}`);
  try {
    await fs.mkdir(dir);
  } catch {
    // Occupato: reclama solo se il proprietario è morto o lo slot è stantio.
    try {
      const pidFile = path.join(dir, 'pid');
      let stale = false;
      try {
        const pid = Number((await fs.readFile(pidFile, 'utf8')).trim());
        const st = await fs.stat(pidFile);
        stale = !pidAlive(pid) || Date.now() - st.mtimeMs > SLOT_STALE_MS;
      } catch {
        // pid file mancante/illeggibile: slot orfano se la dir è vecchia.
        const st = await fs.stat(dir).catch(() => null);
        stale = !st || Date.now() - st.mtimeMs > SLOT_STALE_MS;
      }
      if (!stale) return null;
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir);
    } catch {
      return null; // qualcun altro ha vinto la corsa: riprova più tardi
    }
  }
  await fs.writeFile(path.join(dir, 'pid'), String(process.pid)).catch(() => {});
  return dir;
}

async function acquireBrowserSlot() {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  await fs.mkdir(SLOT_ROOT, { recursive: true }).catch(() => {});
  const deadline = Date.now() + SLOT_WAIT_TIMEOUT_MS;
  for (;;) {
    for (let i = 0; i < MAX_SLOTS; i++) {
      const dir = await tryClaimSlot(fs, path, i);
      if (dir) {
        let released = false;
        const release = async () => {
          if (released) return;
          released = true;
          await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        };
        return release;
      }
    }
    if (Date.now() > deadline) {
      // Non bloccare per sempre: meglio tentare il launch (con retry) che
      // far fallire la suite per timeout del semaforo.
      return async () => {};
    }
    await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 500)));
  }
}

// Avvia chromium headless con gli args standard per l'ambiente sandbox.
// Concorrenza limitata dal semaforo cross-process (vedi sopra) + retry con
// backoff sugli errori di launch (thread/risorse esaurite): lo slot viene
// rilasciato automaticamente a browser.close() o alla disconnessione.
export async function launchBrowser() {
  const { chromium } = await import('playwright-core');
  const release = await acquireBrowserSlot();
  const attempts = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      const browser = await chromium.launch({
        executablePath: chromiumPath(),
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
      // Rilascio dello slot in ogni percorso di chiusura (close esplicito,
      // crash del processo browser, kill esterno).
      browser.on('disconnected', () => { void release(); });
      const origClose = browser.close.bind(browser);
      browser.close = async (...args) => {
        try {
          return await origClose(...args);
        } finally {
          await release();
        }
      };
      return browser;
    } catch (err) {
      if (attempt >= attempts) {
        await release();
        throw err;
      }
      // Tipico: "pthread_create: Resource temporarily unavailable" /
      // "browserType.launch: Target page, context or browser has been closed".
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500)));
    }
  }
}

// Viewport di riferimento per i test mobile (iPhone-like, 375×812).
export const MOBILE_VIEWPORT = { width: 375, height: 812 };

// Crea un context Playwright con il cookie di sessione iniettato.
// Opzioni:
//   - mobile: true  => viewport 375×812 + touch + isMobile (smartphone);
//   - viewport: {width,height} => viewport custom (senza flag touch).
export async function newAuthedContext(browser, session, { domain = 'localhost', path = '/', mobile = false, viewport } = {}) {
  const context = await browser.newContext(
    mobile
      ? { viewport: viewport ?? MOBILE_VIEWPORT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : viewport
        ? { viewport }
        : {},
  );
  await context.addCookies([
    { name: session.cookie.name, value: session.cookie.value, domain, path },
  ]);
  return context;
}

// Imposta ruolo + addetti BiSuite del profilo (la route rilegge il profilo
// ad ogni richiesta, così si simulano admin/operatore senza login multipli).
export async function setRole(pool, profileId, role, addetti = []) {
  await pool.query(
    `UPDATE profiles SET role = $2, bisuite_addetti = $3::text[] WHERE id = $1`,
    [profileId, role, addetti],
  );
}

// Imposta la data trigger Customer Journey dell'org (config JSONB
// `customerJourneyTriggerDate`). I test seminano journey con date "now()" o
// pre-cutover: abbassare il trigger evita che il floor dell'analisi gettoni
// (che mostra solo le SIM dal trigger in poi) le escluda. `date` = stringa ISO
// 'YYYY-MM-DD' (o null per ripristinare il default di sistema).
export async function setCjTriggerDate(pool, orgId, date) {
  await pool.query(
    `INSERT INTO organization_config (organization_id, config, config_version)
       VALUES ($1, jsonb_build_object('customerJourneyTriggerDate', $2::text), '2.0')
     ON CONFLICT (organization_id)
       DO UPDATE SET config = COALESCE(organization_config.config, '{}'::jsonb)
                       || jsonb_build_object('customerJourneyTriggerDate', $2::text),
                     updated_at = now()`,
    [orgId, date],
  );
}

// Inserisce una journey privata con N item. `items` = [{driver, state, importo?,
// addetto?, pdv?}]; addetto/pdv di default presi dai parametri della journey.
// `openedAt` (opzionale, ISO date string o Date) imposta la data di attivazione
// SIM (T0); default `now()`. Ritorna l'id (uuid) della journey.
export async function seedJourney(pool, orgId, { customerKey, nome, addetto = null, pdv = null, openedAt = null, dataInserimento = null, items = [] }) {
  const cj = await pool.query(
    `INSERT INTO customer_journeys (organization_id, customer_key, customer_type, nome, status, opened_at)
       VALUES ($1, $2, 'privato', $3, 'aperta', COALESCE($4::timestamptz, now()))
     RETURNING id`,
    [orgId, customerKey, nome, openedAt],
  );
  const journeyId = cj.rows[0].id;
  for (const it of items) {
    // `dataInserimento` di journey come default per gli item (override per-item
    // possibile); serve al filtro a intervallo per data inserimento.
    await addJourneyItem(pool, orgId, journeyId, { addetto, pdv, dataInserimento, ...it });
  }
  return journeyId;
}

// Semina le valenze di una sezione per (org, month, year). `rows` = array di
// oggetti { name, <trackId>: number|null, ... } come quelli prodotti dal parse
// Excel lato client. Upsert sull'indice unico (org, month, year, section) così
// è ripetibile. Usato dai test UI dell'Incentivazione interna.
export async function seedValenze(pool, orgId, { month, year, sectionId, rows, fileName = 'valenze-test.xlsx' }) {
  await pool.query(
    `INSERT INTO incentivazione_valenze (organization_id, month, year, section_id, file_name, rows)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (organization_id, month, year, section_id)
       DO UPDATE SET rows = EXCLUDED.rows, file_name = EXCLUDED.file_name, uploaded_at = now()`,
    [orgId, month, year, sectionId, fileName, JSON.stringify(rows)],
  );
}

// Aggiunge un singolo item a una journey esistente.
export async function addJourneyItem(pool, orgId, journeyId, { driver, addetto = null, pdv = null, importo = null, state = 'inserito', dataInserimento = null }) {
  await pool.query(
    `INSERT INTO customer_journey_items
       (journey_id, organization_id, driver, addetto, state, data_inserimento, pdv_destinazione, importo)
     VALUES ($1, $2, $3, $4, $5, COALESCE($8::timestamptz, now()), $6, $7)`,
    [journeyId, orgId, driver, addetto, state, pdv, importo, dataInserimento],
  );
}

// Rimuove TUTTI i dati di test creati per una sessione (ogni tabella
// con FK su organizations + l'org stessa). L'ordine cancella prima
// tutti i figli, così il DELETE finale dell'org non può fallire per
// vincolo di FK lasciando l'org orfana nel DB (causa storica delle
// "UITestOrg" superflue accumulate: l'org delete falliva in silenzio
// quando la sessione aveva seminato bisuite_sales/config/ecc.).
// Tollerante agli errori per essere usato in `finally`.
export async function cleanupOrg(pool, session) {
  const orgId = session.orgId;
  // Cancella i figli in ordine di dipendenza (più interni prima), poi l'org.
  // Le tabelle con FK ON DELETE CASCADE (finplan_data,
  // bisuite_sync_notifications) vengono rimosse dall'ultimo DELETE.
  const childTables = [
    'customer_journey_items',
    'customer_journeys',
    'cdg_spese',
    'cdg_pdv_manuali',
    'cdg_categorie',
    'cdg_fornitori',
    'cdg_ragioni_sociali',
    'bisuite_sales',
    'dts_leads',
    'drms_uploads',
    'gara_config',
    'incentivazione_valenze',
    'incentivazione_config',
    'pdv_configurations',
    'organization_config',
    'preventivi',
    'profiles',
  ];
  for (const t of childTables) {
    await pool.query(`DELETE FROM ${t} WHERE organization_id = $1`, [orgId]).catch(() => {});
  }
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]).catch(() => {});
}
