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

// Avvia chromium headless con gli args standard per l'ambiente sandbox.
export async function launchBrowser() {
  const { chromium } = await import('playwright-core');
  return chromium.launch({
    executablePath: chromiumPath(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
}

// Crea un context Playwright con il cookie di sessione iniettato.
export async function newAuthedContext(browser, session, { domain = 'localhost', path = '/' } = {}) {
  const context = await browser.newContext();
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

// Inserisce una journey privata con N item. `items` = [{driver, state, importo?,
// addetto?, pdv?}]; addetto/pdv di default presi dai parametri della journey.
// `openedAt` (opzionale, ISO date string o Date) imposta la data di attivazione
// SIM (T0); default `now()`. Ritorna l'id (uuid) della journey.
export async function seedJourney(pool, orgId, { customerKey, nome, addetto = null, pdv = null, openedAt = null, items = [] }) {
  const cj = await pool.query(
    `INSERT INTO customer_journeys (organization_id, customer_key, customer_type, nome, status, opened_at)
       VALUES ($1, $2, 'privato', $3, 'aperta', COALESCE($4::timestamptz, now()))
     RETURNING id`,
    [orgId, customerKey, nome, openedAt],
  );
  const journeyId = cj.rows[0].id;
  for (const it of items) {
    await addJourneyItem(pool, orgId, journeyId, { addetto, pdv, ...it });
  }
  return journeyId;
}

// Aggiunge un singolo item a una journey esistente.
export async function addJourneyItem(pool, orgId, journeyId, { driver, addetto = null, pdv = null, importo = null, state = 'inserito' }) {
  await pool.query(
    `INSERT INTO customer_journey_items
       (journey_id, organization_id, driver, addetto, state, data_inserimento, pdv_destinazione, importo)
     VALUES ($1, $2, $3, $4, $5, now(), $6, $7)`,
    [journeyId, orgId, driver, addetto, state, pdv, importo],
  );
}

// Rimuove tutti i dati di test creati per una sessione (item, journey,
// profilo, org). Tollerante agli errori per essere usato in `finally`.
export async function cleanupOrg(pool, session) {
  for (const q of [
    [`DELETE FROM customer_journey_items WHERE organization_id = $1`, [session.orgId]],
    [`DELETE FROM customer_journeys WHERE organization_id = $1`, [session.orgId]],
    [`DELETE FROM profiles WHERE id = $1`, [session.profileId]],
    [`DELETE FROM organizations WHERE id = $1`, [session.orgId]],
  ]) {
    await pool.query(q[0], q[1]).catch(() => {});
  }
}
