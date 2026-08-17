import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BASE,
  uniq,
  signup,
  newPool,
  launchBrowser,
  newAuthedContext,
  cleanupOrg,
} from './helpers/uiTest.mjs';
// appearance.ts è pura (nessun import di alias/react): importabile via tsx.
import { ACCENT_PRESETS } from '../client/src/lib/appearance.ts';

// Test suite UI Playwright per le preferenze aspetto per-utente (Task #407):
// tema chiaro/scuro/sistema + palette brand (preset o colore libero) devono
// applicarsi subito, persistere sul server (profiles.ui_prefs, merge jsonb
// atomico via PATCH /api/auth/ui-prefs) e "seguire" l'utente su un nuovo
// dispositivo (contesto browser senza localStorage) via sync AUTH_PROFILE_EVENT.
//
// Copre:
//   1. cambio preset palette dalla card Aspetto (/profile): CSS var --primary
//      cambia + persistenza server;
//   2. colore personalizzato (input color + blur);
//   3. toggle dark/light: classe .dark su <html> + persistenza;
//   4. reload: le scelte restano applicate (localStorage + pre-paint);
//   5. "nuovo dispositivo": secondo contesto SENZA localStorage con lo stesso
//      cookie => tema+palette arrivano dal server;
//   6. race tema+palette ravvicinati: entrambe le chiavi sopravvivono nel
//      jsonb (merge atomico, niente lost update);
//   7. parità statica: la tabella PRESETS nel pre-paint script di
//      client/index.html combacia con ACCENT_PRESETS di appearance.ts.

const TEAL = ACCENT_PRESETS.find((p) => p.id === 'teal');
const ROSE = ACCENT_PRESETS.find((p) => p.id === 'rose');
const hslStr = (c) => `${c.h} ${c.s}% ${c.l}%`;

async function getPrimaryVar(page) {
  return (await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--primary'),
  )).trim();
}

async function isDarkClass(page) {
  return page.evaluate(() => document.documentElement.classList.contains('dark'));
}

// Poll finché il predicato sul valore letto è vero (le PATCH server sono
// fire-and-forget: il DB può aggiornarsi qualche istante dopo il click).
async function waitFor(fn, pred, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await fn();
    if (pred(last)) return last;
    if (Date.now() > deadline) {
      assert.fail(`timeout waiting for ${label}; last value: ${JSON.stringify(last)}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function readUiPrefs(pool, profileId) {
  const r = await pool.query(`SELECT ui_prefs FROM profiles WHERE id = $1`, [profileId]);
  return r.rows[0]?.ui_prefs ?? null;
}

async function openProfile(page) {
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
  await page.getByTestId('card-aspetto').waitFor({ state: 'visible', timeout: 20000 });
}

// Attende che il sync iniziale di UiPrefsSync sia COMPLETO: al primo accesso
// di un utente il componente applica i default ("utente diverso" senza marker
// locale) e ogni setTheme/setAccent spara una PATCH fire-and-forget. Se i
// click del test partono mentre quelle PATCH sono ancora in volo, possono
// arrivare al server DOPO e sovrascrivere la scelta del test (es. theme
// "system" che batte "dark"). Aspettiamo quindi il marker locale + la
// comparsa di theme+accent di default in profiles.ui_prefs.
async function waitInitialPrefsSync(page, pool, profileId) {
  await waitFor(
    () => page.evaluate(() => localStorage.getItem('mystoredesk-prefs-user')),
    (v) => v === profileId,
    'UiPrefsSync local marker (mystoredesk-prefs-user)',
  );
  await waitFor(
    () => readUiPrefs(pool, profileId),
    (p) => p?.theme != null && p?.accent != null,
    'initial default prefs persisted to server (theme+accent)',
  );
}

// ===========================================================================
// SCENARIO 1: preset + custom + dark/light si applicano subito, persistono sul
// server, sopravvivono al reload e "seguono" l'utente su un nuovo dispositivo.
// ===========================================================================
test('scenario 1: preset, custom color, dark mode: apply, persist, reload, new device sync', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'aspetto_ui', fullName: 'Aspetto UI Test', organizationName: uniq('AspettoUI') });
  const browser = await launchBrowser();
  try {
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await openProfile(page);
    await waitInitialPrefsSync(page, pool, session.profileId);

    // --- Cambio preset (teal): la CSS var --primary cambia subito ---
    const before = await getPrimaryVar(page);
    await page.getByTestId('btn-accent-teal').click();
    const afterTeal = await waitFor(
      () => getPrimaryVar(page),
      (v) => v === hslStr(TEAL.light),
      `--primary to become teal light (${hslStr(TEAL.light)})`,
    );
    assert.notEqual(afterTeal, before, 'accent change must alter --primary');

    // Persistenza server: profiles.ui_prefs.accent = preset teal.
    await waitFor(
      () => readUiPrefs(pool, session.profileId),
      (p) => p?.accent?.type === 'preset' && p.accent.id === 'teal',
      'server ui_prefs.accent = {preset, teal}',
    );

    // --- Dark mode: classe .dark + --primary passa alla variante dark ---
    await page.getByTestId('btn-theme-dark').click();
    await waitFor(() => isDarkClass(page), (v) => v === true, 'html.dark class after clicking Scuro');
    await waitFor(
      () => getPrimaryVar(page),
      (v) => v === hslStr(TEAL.dark),
      `--primary to become teal dark (${hslStr(TEAL.dark)})`,
    );
    await waitFor(
      () => readUiPrefs(pool, session.profileId),
      (p) => p?.theme === 'dark',
      'server ui_prefs.theme = dark',
    );

    // --- Colore personalizzato: fill + blur sull'input color ---
    // #336699 => hsl(210, 50%, 40%); in dark il primario viene schiarito +10 => l=50.
    await page.getByTestId('input-accent-custom').fill('#336699');
    await page.getByTestId('input-accent-custom').blur();
    await waitFor(
      () => getPrimaryVar(page),
      (v) => v === '210 50% 50%',
      '--primary to become custom #336699 (dark-lightened: 210 50% 50%)',
    );
    await waitFor(
      () => readUiPrefs(pool, session.profileId),
      (p) => p?.accent?.type === 'custom' && p.accent.hex?.toLowerCase() === '#336699',
      'server ui_prefs.accent = {custom, #336699}',
    );

    // --- Reload: localStorage + pre-paint riapplicano tutto ---
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await isDarkClass(page), true, 'dark class must survive reload');
    assert.equal(await getPrimaryVar(page), '210 50% 50%', 'custom accent must survive reload');

    // --- Torna light: la variante custom NON schiarita (l=40) ---
    await openProfile(page);
    await page.getByTestId('btn-theme-light').click();
    await waitFor(() => isDarkClass(page), (v) => v === false, 'dark class removed after Chiaro');
    await waitFor(
      () => getPrimaryVar(page),
      (v) => v === '210 50% 40%',
      '--primary custom light variant (210 50% 40%)',
    );
    await waitFor(
      () => readUiPrefs(pool, session.profileId),
      (p) => p?.theme === 'light' && p?.accent?.type === 'custom',
      'server ui_prefs {theme: light, accent: custom} after switch back',
    );

    await page.close();
    await context.close();

    // --- "Nuovo dispositivo": contesto fresco senza localStorage, solo cookie.
    // Il sync via AUTH_PROFILE_EVENT deve applicare tema+palette dal server.
    const fresh = await newAuthedContext(browser, session);
    const page2 = await fresh.newPage();
    await page2.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await waitFor(
      () => getPrimaryVar(page2),
      (v) => v === '210 50% 40%',
      'fresh context: --primary synced from server (custom light)',
      20000,
    );
    assert.equal(await isDarkClass(page2), false, 'fresh context: theme light synced from server');
    // Il sync deve anche specchiare in localStorage (mirror per il pre-paint).
    const mirroredTheme = await page2.evaluate(() => localStorage.getItem('mystoredesk-theme'));
    assert.equal(mirroredTheme, 'light', 'fresh context must mirror theme into localStorage');
    const mirroredAccent = JSON.parse(
      await page2.evaluate(() => localStorage.getItem('mystoredesk-accent')),
    );
    assert.deepEqual(mirroredAccent, { type: 'custom', hex: '#336699' }, 'fresh context must mirror accent into localStorage');

    // --- Stabilità UI con palette non-default (Task #413) ---
    // Con l'accent custom attivo, la Home deve rendere normalmente e i
    // selettori data-testid devono restare validi: nessun test deve
    // dipendere da colori/classi della palette di default.
    await page2.getByTestId('text-home-title').waitFor({ state: 'visible', timeout: 20000 });

    await page2.close();
    await fresh.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: PATCH tema+palette ravvicinate NON si perdono a vicenda
// (merge jsonb atomico lato server).
// ===========================================================================
test('scenario 2: near-simultaneous theme+accent changes both persist (atomic jsonb merge)', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'aspetto_ui', fullName: 'Aspetto UI Test', organizationName: uniq('AspettoUI') });
  const browser = await launchBrowser();
  try {
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await openProfile(page);
    // Lascia atterrare le PATCH del sync iniziale prima dei click, altrimenti
    // il default "system" in volo può sovrascrivere il "dark" del test.
    await waitInitialPrefsSync(page, pool, session.profileId);

    // Click ravvicinati senza attese intermedie: le due PATCH fire-and-forget
    // restano in volo insieme. (Niente Promise.all sui click: due azioni
    // pointer concorrenti sulla stessa pagina si disturbano a vicenda e una
    // può andare persa — la concorrenza vera è testata sotto via HTTP.)
    await page.getByTestId('btn-theme-dark').click();
    await page.getByTestId('btn-accent-rose').click();

    // Entrambe le chiavi devono finire nel jsonb, nessun lost update.
    const prefs = await waitFor(
      () => readUiPrefs(pool, session.profileId),
      (p) => p?.theme === 'dark' && p?.accent?.type === 'preset' && p.accent.id === 'rose',
      'server ui_prefs with BOTH theme=dark and accent=rose',
    );
    assert.equal(prefs.theme, 'dark');
    assert.deepEqual(prefs.accent, { type: 'preset', id: 'rose' });

    // E in pagina: dark + rose variante dark.
    await waitFor(() => isDarkClass(page), (v) => v === true, 'html.dark after race');
    await waitFor(
      () => getPrimaryVar(page),
      (v) => v === hslStr(ROSE.dark),
      `--primary rose dark (${hslStr(ROSE.dark)}) after race`,
    );

    // Raffica di PATCH dirette ravvicinate (senza UI): il merge SQL non deve
    // perdere chiavi anche sotto richieste concorrenti vere.
    const req = (body) =>
      fetch(`${BASE}/api/auth/ui-prefs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: session.cookieHeader },
        body: JSON.stringify(body),
      });
    const results = await Promise.all([
      req({ theme: 'light' }),
      req({ accent: { type: 'preset', id: 'emerald' } }),
    ]);
    for (const r of results) assert.equal(r.status, 200, 'both concurrent PATCHes must succeed');
    const finalPrefs = await waitFor(
      () => readUiPrefs(pool, session.profileId),
      (p) => p?.theme === 'light' && p?.accent?.id === 'emerald',
      'server ui_prefs with theme=light AND accent=emerald after direct concurrent PATCHes',
    );
    assert.equal(finalPrefs.theme, 'light');
    assert.deepEqual(finalPrefs.accent, { type: 'preset', id: 'emerald' });

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 3 (statico): la tabella PRESETS nel pre-paint script di
// client/index.html deve combaciare con ACCENT_PRESETS di appearance.ts
// (stesse hsl light/dark per ogni id, indigo escluso: è il default senza
// override). Se qualcuno aggiunge/cambia un preset in un solo posto, il
// flash pre-paint mostrerebbe il colore sbagliato.
// ===========================================================================
test('scenario 3: pre-paint PRESETS table in index.html matches appearance.ts', () => {
  const html = fs.readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
  const m = /var PRESETS = \{([\s\S]*?)\};/.exec(html);
  assert.ok(m, 'PRESETS table not found in client/index.html pre-paint script');
  // Parse "id: [[h,s,l],[h,s,l]]," entries.
  const entries = {};
  const re = /(\w+):\s*\[\[(\d+),\s*(\d+),\s*(\d+)\],\s*\[(\d+),\s*(\d+),\s*(\d+)\]\]/g;
  let e;
  while ((e = re.exec(m[1])) !== null) {
    entries[e[1]] = {
      light: { h: +e[2], s: +e[3], l: +e[4] },
      dark: { h: +e[5], s: +e[6], l: +e[7] },
    };
  }
  const expected = ACCENT_PRESETS.filter((p) => p.id !== 'indigo');
  assert.equal(
    Object.keys(entries).length,
    expected.length,
    `index.html PRESETS must list every non-default preset (${expected.map((p) => p.id).join(', ')})`,
  );
  for (const p of expected) {
    assert.deepEqual(
      entries[p.id],
      { light: p.light, dark: p.dark },
      `pre-paint values for preset "${p.id}" must match appearance.ts`,
    );
  }
});
