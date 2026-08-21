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
// tema chiaro/scuro/sistema + composizione Prisma Light della Dashboard +
// palette brand (preset o colore libero) devono
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
//   7. Prisma Light: schema GLOBALE (Task #461) separato dal tema base,
//      server sync, skin attiva su tutte le route e bottom bar mobile fissa
//      sulla Dashboard;
//   8. Midnight Violet: schema GLOBALE che forza dark ovunque;
//   9. parità statica: la tabella PRESETS nel pre-paint script di
//      client/index.html combacia con ACCENT_PRESETS di appearance.ts.
//  10. sessione scaduta/cambio account: la pagina auth non riceve mai il
//      pre-paint dello schema appartenente all'utente precedente.

const TEAL = ACCENT_PRESETS.find((p) => p.id === 'teal');
const ROSE = ACCENT_PRESETS.find((p) => p.id === 'rose');
const hslStr = (c) => `${c.h} ${c.s}% ${c.l}%`;

async function getPrimaryVar(page) {
  return (await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--primary'),
  )).trim();
}

async function assertActiveNavUsesPrimary(page, testId, label) {
  const colors = await page.evaluate((id) => {
    const item = document.querySelector(`[data-testid="${id}"]`);
    if (!item) return null;
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'hsl(var(--primary))';
    document.body.appendChild(probe);
    const result = {
      active: getComputedStyle(item).backgroundColor,
      primary: getComputedStyle(probe).backgroundColor,
    };
    probe.remove();
    return result;
  }, testId);
  assert.ok(colors, `${label}: voce attiva presente`);
  assert.equal(colors.active, colors.primary, `${label}: voce attiva usa l'arancione primary`);
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
// comparsa delle preferenze di default in profiles.ui_prefs.
async function waitInitialPrefsSync(page, pool, profileId) {
  await waitFor(
    () => page.evaluate(() => localStorage.getItem('mystoredesk-prefs-user')),
    (v) => v === profileId,
    'UiPrefsSync local marker (mystoredesk-prefs-user)',
  );
  await waitFor(
    () => readUiPrefs(pool, profileId),
    (p) => p?.theme != null && p?.accent != null && p?.scheme != null,
    'initial default prefs persisted to server (theme+accent+scheme)',
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

    // --- Prisma Light: schema GLOBALE separato dal tema base ---
    // Parti da dark: selezionare Prisma NON deve sovrascrivere il tema base
    // salvato, ma applica subito la pelle chiara su TUTTE le pagine.
    await page.getByTestId('btn-theme-dark').click();
    await waitFor(
      () => readUiPrefs(pool, session.profileId),
      (p) => p?.theme === 'dark' && p?.scheme === 'standard',
      'server base theme dark before Prisma selection',
    );
    await page.getByTestId('btn-theme-prisma-light').click();
    await waitFor(
      () => readUiPrefs(pool, session.profileId),
      (p) => p?.theme === 'dark' && p?.scheme === 'prisma-light',
      'server ui_prefs preserves theme dark with scheme prisma-light',
    );
    await waitFor(() => isDarkClass(page), (v) => v === false,
      'Prisma Light forza il chiaro anche sulla pagina Profilo (schema globale)');
    assert.equal(
      await page.evaluate(() => document.documentElement.getAttribute('data-skin')),
      'prisma-light',
      'la skin Prisma deve essere attiva anche sulla pagina Profilo',
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem('mystoredesk-scheme')),
      'prisma-light',
      'lo schema globale deve essere specchiato in localStorage',
    );

    await page.close();
    await context.close();

    // --- "Nuovo dispositivo": contesto fresco senza localStorage, solo cookie.
    // Il sync via AUTH_PROFILE_EVENT deve applicare tema+palette dal server.
    const fresh = await newAuthedContext(browser, session, { mobile: true });
    const page2 = await fresh.newPage();
    await page2.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle' });
    await page2.getByTestId('dashboard-gara-reale').waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await isDarkClass(page2), false,
      'Prisma forza il chiaro (schema globale) anche col tema base dark');
    // Il sync deve anche specchiare in localStorage (mirror per il pre-paint).
    const mirroredTheme = await page2.evaluate(() => localStorage.getItem('mystoredesk-theme'));
    assert.equal(mirroredTheme, 'dark', 'fresh context must mirror the preserved base theme into localStorage');
    const mirroredAccent = JSON.parse(
      await page2.evaluate(() => localStorage.getItem('mystoredesk-accent')),
    );
    assert.deepEqual(mirroredAccent, { type: 'custom', hex: '#336699' }, 'fresh context must mirror accent into localStorage');
    assert.equal(
      await page2.evaluate(() => localStorage.getItem('mystoredesk-scheme')),
      'prisma-light',
      'fresh context must mirror the global scheme into localStorage',
    );
    await page2.getByTestId('prisma-mobile-bottom-bar').waitFor({ state: 'visible', timeout: 20000 });
    const bottomBar = await page2.getByTestId('prisma-mobile-bottom-bar').evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        position: style.position,
        bottom: Math.round(window.innerHeight - rect.bottom),
      };
    });
    assert.equal(bottomBar.position, 'fixed', 'la bottom bar Prisma mobile deve restare fissa');
    assert.ok(bottomBar.bottom >= 0 && bottomBar.bottom <= 20,
      `la bottom bar deve aderire al fondo viewport (bottom=${bottomBar.bottom})`);
    assert.equal(
      await page2.getByTestId('prisma-mobile-nav-dashboard-gara-reale').getAttribute('aria-current'),
      'page',
      'la voce Dashboard della bottom bar deve indicare la route attiva',
    );

    // --- Schema globale: navigando fuori dalla Dashboard la skin RESTA ---
    await page2.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
    await page2.getByTestId('card-aspetto').waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(
      await page2.evaluate(() => document.documentElement.getAttribute('data-skin')),
      'prisma-light',
      'la skin Prisma (globale) deve restare attiva anche fuori dalla Dashboard',
    );
    assert.equal(await isDarkClass(page2), false,
      'Prisma resta chiaro su ogni pagina, anche col tema base dark salvato');
    await waitFor(
      () => getPrimaryVar(page2),
      (v) => v === '210 50% 40%',
      'fresh context: custom accent LIGHT variant while Prisma is active',
      20000,
    );

    // --- Torna al tema base: la skin sparisce e il dark salvato riemerge ---
    await page2.getByTestId('btn-theme-dark').click();
    await waitFor(
      () => page2.evaluate(() => document.documentElement.hasAttribute('data-skin')),
      (v) => v === false,
      'selezionare Scuro rimuove la skin globale',
    );
    await waitFor(() => isDarkClass(page2), (v) => v === true, 'dark base theme active again');

    // --- Midnight Violet: schema globale che forza dark ovunque ---
    await page2.getByTestId('btn-theme-light').click();
    await waitFor(
      () => readUiPrefs(pool, session.profileId),
      (p) => p?.theme === 'light' && p?.scheme === 'standard',
      'server stores light base theme before Midnight Violet',
    );
    assert.equal(await isDarkClass(page2), false, 'the light base theme must be active before Midnight');
    await page2.getByTestId('btn-theme-midnight-violet').click();
    await waitFor(
      () => readUiPrefs(pool, session.profileId),
      (p) => p?.theme === 'light' && p?.scheme === 'midnight-violet',
      'server preserves base light theme with scheme midnight-violet',
    );
    await waitFor(() => isDarkClass(page2), (v) => v === true,
      'Midnight Violet forza il dark anche sulla pagina Profilo');
    assert.equal(
      await page2.evaluate(() => document.documentElement.getAttribute('data-skin')),
      'midnight-violet',
      'la skin Midnight deve essere attiva anche fuori da Vendite (globale)',
    );
    await waitFor(
      () => getPrimaryVar(page2),
      (v) => v === '35 91% 60%',
      'Midnight mantiene il primary arancione anche con un accento custom salvato',
    );
    await page2.goto(`${BASE}/vendite-bisuite`, { waitUntil: 'networkidle' });
    await page2.getByTestId('vendite-bisuite-page').waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(
      await page2.getByTestId('vendite-bisuite-page').getAttribute('data-sales-style'),
      'midnight-violet',
      'Vendite BiSuite must render the Midnight Violet composition',
    );
    assert.equal(
      await page2.evaluate(() => document.documentElement.getAttribute('data-skin')),
      'midnight-violet',
      'Midnight Violet data-skin must be active on Vendite BiSuite',
    );
    assert.equal(await isDarkClass(page2), true, 'Midnight Violet must force dark rendering on Vendite BiSuite');
    assert.equal(await getPrimaryVar(page2), '35 91% 60%',
      'Vendite mantiene il primary arancione di Midnight');
    await assertActiveNavUsesPrimary(
      page2,
      'nav-gara-vendite-bisuite',
      'Vendite / Midnight',
    );
    await page2.goto(`${BASE}/customer-journey`, { waitUntil: 'networkidle' });
    await page2.getByTestId('input-search-journey').waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await getPrimaryVar(page2), '35 91% 60%',
      'Customer Journey mantiene lo stesso primary arancione di Vendite');
    await assertActiveNavUsesPrimary(
      page2,
      'nav-gara-customer-journey',
      'Customer Journey / Midnight',
    );
    await page2.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
    await page2.getByTestId('card-aspetto').waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(
      await page2.evaluate(() => document.documentElement.getAttribute('data-skin')),
      'midnight-violet',
      'Midnight Violet (globale) deve restare attivo anche fuori da Vendite',
    );
    assert.equal(await isDarkClass(page2), true, 'Midnight keeps forcing dark outside Vendite too');

    // Il logout deve cancellare il mirror locale per evitare che un altro
    // account nello stesso browser riceva il pre-paint dell'utente uscente.
    await page2.getByTestId('button-user-menu').click();
    await page2.getByText('Esci', { exact: true }).click();
    await page2.waitForURL(/\/auth\/?$/, { timeout: 20000 });
    const localPrefsAfterLogout = await page2.evaluate(() => ({
      theme: localStorage.getItem('mystoredesk-theme'),
      accent: localStorage.getItem('mystoredesk-accent'),
      scheme: localStorage.getItem('mystoredesk-scheme'),
      dashboardStyle: localStorage.getItem('mystoredesk-dashboard-style'),
      salesStyle: localStorage.getItem('mystoredesk-sales-style'),
      user: localStorage.getItem('mystoredesk-prefs-user'),
    }));
    assert.deepEqual(localPrefsAfterLogout, {
      theme: null,
      accent: null,
      scheme: null,
      dashboardStyle: null,
      salesStyle: null,
      user: null,
    }, 'logout must clear every per-user appearance mirror');

    await page2.close();
    await fresh.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

test('scenario 1b: session expiry bypassing UI logout never paints the previous user scheme on auth', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'aspetto_expired', fullName: 'Appearance Expired Session' });
  const browser = await launchBrowser();
  try {
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await openProfile(page);
    await waitInitialPrefsSync(page, pool, session.profileId);
    await page.getByTestId('btn-theme-midnight-violet').click();
    await waitFor(
      () => page.evaluate(() => document.documentElement.getAttribute('data-skin')),
      (v) => v === 'midnight-violet',
      'Midnight active before direct session expiry',
    );

    const beforeExpiry = await page.evaluate(() => ({
      owner: localStorage.getItem('mystoredesk-prefs-user'),
      active: sessionStorage.getItem('mystoredesk-auth-session-user'),
      scheme: localStorage.getItem('mystoredesk-scheme'),
    }));
    assert.deepEqual(beforeExpiry, {
      owner: session.profileId,
      active: session.profileId,
      scheme: 'midnight-violet',
    }, 'precondition: mirror and active session belong to the first user');

    // Invalida la sessione direttamente, senza passare da AppNavbar/signOut:
    // simula cookie scaduto o account switch avviato da una nuova schermata.
    await page.evaluate(async () => {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`logout failed: ${response.status}`);
    });
    await page.addInitScript(() => {
      window.__sawPreviousSchemeOnAuth = false;
      const root = document.documentElement;
      const record = () => {
        if (root.getAttribute('data-skin') === 'midnight-violet') {
          window.__sawPreviousSchemeOnAuth = true;
        }
      };
      record();
      new MutationObserver(record).observe(root, {
        attributes: true,
        attributeFilter: ['data-skin', 'class'],
      });
    });
    await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle' });

    assert.equal(
      await page.evaluate(() => window.__sawPreviousSchemeOnAuth),
      false,
      'auth bootstrap must never apply the expired user Midnight scheme',
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.getAttribute('data-skin')),
      null,
      'auth page must stay on the neutral standard scheme',
    );
    await waitFor(
      () => page.evaluate(() => ({
        owner: localStorage.getItem('mystoredesk-prefs-user'),
        active: sessionStorage.getItem('mystoredesk-auth-session-user'),
        scheme: localStorage.getItem('mystoredesk-scheme'),
      })),
      (v) => v.owner === null && v.active === null && v.scheme === null,
      '401 bootstrap clears appearance mirrors and active identity',
    );

    await page.close();
    await context.close();
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
// SCENARIO 4 (Task #454): il pannello verde "Provenienza verificabile" di
// Prisma Light deve dire la verità sui calendari di gara:
//   a) config con calendari MISTI (un PDV con calendario, uno senza) =>
//      il testo deve chiarire che il filtro vale solo per i PDV con
//      calendario configurato;
//   b) config SENZA calendari => il testo deve dire che vengono considerate
//      tutte le vendite del mese.
// In entrambi i casi il ticker "Piste in gara" e i dettagli standard devono
// restare assenti in Prisma.
// ===========================================================================
test('scenario 4: Prisma provenance panel text is truthful for mixed and absent gara calendars', async () => {
  const pool = await newPool();
  const browser = await launchBrowser();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dataVendita = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-10T10:00:00.000Z`;
  const insertSale = async (orgId, codicePos, nomeNegozio) => {
    await pool.query(
      `INSERT INTO bisuite_sales (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio, ragione_sociale, stato, raw_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [orgId, Math.floor(Math.random() * 2_000_000_000), dataVendita, codicePos, nomeNegozio, 'Prisma Prov Srl', 'ATTIVO',
        JSON.stringify({ cliente: { clienteTipo: 'PRIVATO' }, articoli: [{ categoria: { nome: 'TIED CF' }, tipologia: { nome: 'VOCE EASYPAY' }, dettaglio: { canone: '10' } }] })],
    );
  };
  const fullCalendar = { specialDays: [], weeklySchedule: { workingDays: [0, 1, 2, 3, 4, 5, 6] } };

  const runCase = async ({ prefix, pdvList, expectSubstring, notExpectSubstring }) => {
    const session = await signup({ prefix, fullName: 'Prisma Prov Test', organizationName: uniq('PrismaProv') });
    try {
      await pool.query(
        `UPDATE profiles SET ui_prefs = coalesce(ui_prefs,'{}'::jsonb)
           || '{"theme":"light","dashboardStyle":"prisma-light"}'::jsonb WHERE id = $1`,
        [session.profileId],
      );
      await pool.query(
        `INSERT INTO gara_config (organization_id, month, year, name, config) VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [session.orgId, now.getMonth() + 1, now.getFullYear(), 'Prov Test', JSON.stringify({ pdvList })],
      );
      for (const pdv of pdvList) await insertSale(session.orgId, pdv.codicePos, pdv.nome);

      const context = await newAuthedContext(browser, session);
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.setItem('mystoredesk-theme', 'light');
        localStorage.setItem('mystoredesk-dashboard-style', 'prisma-light');
      });
      await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle' });
      await page.getByTestId('prisma-award').waitFor({ state: 'visible', timeout: 30000 });
      // NB: .pl-tiny è uppercase via CSS text-transform: confronto case-insensitive.
      const text = await page.getByTestId('prisma-award').innerText();
      assert.ok(text.toLowerCase().includes('provenienza verificabile'), `panel label present (${prefix})`);
      assert.ok(text.includes('Stessa base dati della Gara Reale.'), `panel title present (${prefix})`);
      assert.ok(text.includes(expectSubstring),
        `provenance text must be truthful for ${prefix}; got: ${text}`);
      assert.ok(!text.includes(notExpectSubstring),
        `provenance text must NOT claim "${notExpectSubstring}" for ${prefix}; got: ${text}`);
      // I contenuti standard restano assenti in Prisma.
      assert.equal(await page.getByTestId('section-pista-ticker').count(), 0,
        `ticker "Piste in gara" must stay hidden in Prisma (${prefix})`);
      await page.close();
      await context.close();
    } finally {
      await cleanupOrg(pool, session);
    }
  };

  try {
    // a) calendari misti: un PDV con calendario, uno senza.
    await runCase({
      prefix: 'prisma_prov_mix',
      pdvList: [
        { codicePos: uniq('POS'), nome: 'Con Calendario', ragioneSociale: 'Prisma Prov Srl', calendar: fullCalendar },
        { codicePos: uniq('POS'), nome: 'Senza Calendario', ragioneSociale: 'Prisma Prov Srl' },
      ],
      expectSubstring: 'i PDV con calendario di gara configurato contano solo le vendite nei giorni di gara, gli altri tutte le vendite del mese',
      notExpectSubstring: 'senza calendari di gara configurati',
    });
    // b) nessun calendario: fallback esplicito "tutte le vendite del mese".
    await runCase({
      prefix: 'prisma_prov_none',
      pdvList: [
        { codicePos: uniq('POS'), nome: 'PDV Uno', ragioneSociale: 'Prisma Prov Srl' },
        { codicePos: uniq('POS'), nome: 'PDV Due', ragioneSociale: 'Prisma Prov Srl' },
      ],
      expectSubstring: 'senza calendari di gara configurati vengono considerate tutte le vendite del mese',
      notExpectSubstring: 'i PDV con calendario di gara configurato',
    });
  } finally {
    await browser.close().catch(() => {});
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
