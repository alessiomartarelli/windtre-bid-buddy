import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE,
  uniq,
  signup,
  newPool,
  launchBrowser,
  newAuthedContext,
  cleanupOrg,
} from './helpers/uiTest.mjs';

// Verifica che le regole @media print in client/src/index.css cancellino
// l'aurora e i gradienti vetro del tema scuro Vision UI (Task #416),
// rendendo body/shell/card opachi e leggibili in stampa/PDF (Task #417).
//
// Strategia:
//   1. Accede all'app con un account reale (cookie di sessione).
//   2. Inietta la classe .dark sull'<html> come fa il pre-paint script.
//   3. Aggiunge nel DOM elementi con le classi sorvegliate, se assenti.
//   4. Attiva l'emulazione print via page.emulateMedia({ media: 'print' }).
//   5. Controlla le proprietà computed che le regole @media print devono
//      resettare: background-image e box-shadow su body/.glass-panel e
//      background-color opaco su .min-h-screen.bg-background.

test('dark mode @media print: body/shell/glass-panel hanno superfici opache senza gradienti', async () => {
  const pool = await newPool();
  const session = await signup({
    prefix: 'print_dark',
    fullName: 'Print Dark Test',
    organizationName: uniq('PrintDarkOrg'),
  });
  const browser = await launchBrowser();
  try {
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();

    // Naviga all'app e attendi che il markup sia stabile.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    // Inietta .dark sull'elemento radice, esattamente come fa il pre-paint
    // script in produzione (appearance.ts / index.html inline script).
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });

    // Assicura la presenza nel DOM delle classi monitorate dal @media print,
    // indipendentemente dalla pagina su cui si atterra.
    await page.evaluate(() => {
      function ensureEl(selector, className, id) {
        if (!document.querySelector(selector)) {
          const el = document.createElement('div');
          el.className = className;
          el.id = id;
          document.body.appendChild(el);
        }
      }
      ensureEl('.glass-panel', 'glass-panel', 'test-glass-panel');
      ensureEl('.glass-overlay', 'glass-overlay', 'test-glass-overlay');
      ensureEl(
        '.min-h-screen.bg-background',
        'min-h-screen bg-background',
        'test-shell-bg',
      );
      ensureEl(
        '.min-h-screen.bg-gradient-to-br',
        'min-h-screen bg-gradient-to-br',
        'test-shell-grad',
      );
    });

    // ── Verifica pre-print (baseline in dark mode) ─────────────────────────
    // body deve avere l'aurora: background-image != 'none'.
    const bodyBgImageDark = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundImage,
    );
    assert.notEqual(
      bodyBgImageDark,
      'none',
      `baseline: body deve avere l'aurora in dark mode (trovato: ${bodyBgImageDark})`,
    );

    // Task #461: le card dark usano una superficie solida per aumentare il
    // contrasto e ridurre i gradienti decorativi concorrenti.
    const glassDark = await page.evaluate(() => {
      const el = document.querySelector('.glass-panel');
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        backgroundImage: style.backgroundImage,
        backgroundColor: style.backgroundColor,
      };
    });
    assert.ok(glassDark !== null, 'baseline: .glass-panel non trovato');
    assert.equal(
      glassDark.backgroundImage,
      'none',
      `baseline: .glass-panel dark non deve avere gradienti (trovato: ${glassDark.backgroundImage})`,
    );
    assert.notEqual(
      glassDark.backgroundColor,
      'rgba(0, 0, 0, 0)',
      'baseline: .glass-panel dark deve mantenere una superficie opaca',
    );

    // ── Attiva print media ─────────────────────────────────────────────────
    await page.emulateMedia({ media: 'print' });

    // ── Verifica post-print ────────────────────────────────────────────────

    // 1. body: background-image deve essere 'none' (regola .dark body in @media print).
    const bodyBgImage = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundImage,
    );
    assert.equal(
      bodyBgImage,
      'none',
      `body.backgroundImage in print deve essere 'none'; trovato: ${bodyBgImage}`,
    );

    // 2. .glass-panel: background-image deve essere 'none'
    //    (background: hsl(var(--card)) resetta il gradiente).
    const glassBgImage = await page.evaluate(() => {
      const el = document.querySelector('.glass-panel');
      return el ? getComputedStyle(el).backgroundImage : null;
    });
    assert.equal(
      glassBgImage,
      'none',
      `.glass-panel.backgroundImage in print deve essere 'none'; trovato: ${glassBgImage}`,
    );

    // 3. .glass-panel: box-shadow deve essere 'none'.
    const glassBoxShadow = await page.evaluate(() => {
      const el = document.querySelector('.glass-panel');
      return el ? getComputedStyle(el).boxShadow : null;
    });
    assert.equal(
      glassBoxShadow,
      'none',
      `.glass-panel.boxShadow in print deve essere 'none'; trovato: ${glassBoxShadow}`,
    );

    // 4. .glass-overlay: background-image deve essere 'none'.
    const overlayBgImage = await page.evaluate(() => {
      const el = document.querySelector('.glass-overlay');
      return el ? getComputedStyle(el).backgroundImage : null;
    });
    assert.equal(
      overlayBgImage,
      'none',
      `.glass-overlay.backgroundImage in print deve essere 'none'; trovato: ${overlayBgImage}`,
    );

    // 5. .glass-overlay: box-shadow deve essere 'none'.
    const overlayBoxShadow = await page.evaluate(() => {
      const el = document.querySelector('.glass-overlay');
      return el ? getComputedStyle(el).boxShadow : null;
    });
    assert.equal(
      overlayBoxShadow,
      'none',
      `.glass-overlay.boxShadow in print deve essere 'none'; trovato: ${overlayBoxShadow}`,
    );

    // 6. .min-h-screen.bg-background: background-color deve essere opaco
    //    (la regola @media print sovrascrive l'azzeramento dark mode che mette transparent).
    const shellBgColor = await page.evaluate(() => {
      const el = document.querySelector('.min-h-screen.bg-background');
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    assert.ok(shellBgColor !== null, '.min-h-screen.bg-background non trovato nel DOM');
    assert.notEqual(
      shellBgColor,
      'rgba(0, 0, 0, 0)',
      `.min-h-screen.bg-background.backgroundColor in print non deve essere trasparente; trovato: ${shellBgColor}`,
    );
    assert.notEqual(
      shellBgColor,
      'transparent',
      `.min-h-screen.bg-background.backgroundColor in print non deve essere trasparente; trovato: ${shellBgColor}`,
    );

    // 7. .min-h-screen.bg-gradient-to-br: stesso controllo sull'altro selettore shell.
    const shellGradBgColor = await page.evaluate(() => {
      const el = document.querySelector('.min-h-screen.bg-gradient-to-br');
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    assert.ok(shellGradBgColor !== null, '.min-h-screen.bg-gradient-to-br non trovato nel DOM');
    assert.notEqual(
      shellGradBgColor,
      'rgba(0, 0, 0, 0)',
      `.min-h-screen.bg-gradient-to-br.backgroundColor in print non deve essere trasparente; trovato: ${shellGradBgColor}`,
    );
    assert.notEqual(
      shellGradBgColor,
      'transparent',
      `.min-h-screen.bg-gradient-to-br.backgroundColor in print non deve essere trasparente; trovato: ${shellGradBgColor}`,
    );
  } finally {
    await browser.close();
    await cleanupOrg(pool, session);
    await pool.end();
  }
});
