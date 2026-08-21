import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  uniq,
  signup,
  cleanupOrg,
  newPool,
  launchBrowser,
  newAuthedContext,
} from './helpers/uiTest.mjs';

// Task #476 — Contrasto uniforme dei temi scuri e nuovo linguaggio dei bordi.
//
// Verifica, con rapporti di contrasto WCAG calcolati sui colori reali:
//   - testo primario/secondario leggibile su card e overlay (dialog) in
//     entrambi gli schemi scuri (standard e Midnight Violet);
//   - intestazioni tabella e celle sticky (bg-background) su superficie card;
//   - badge semantici bg-<hue>-500/10 rialzati e leggibili;
//   - bordi card "soft": alpha bassa, tonalità fredda (hue 190–250), non il
//     vecchio viola netto;
//   - tema chiaro invariato (nessuna regola dark applicata).

const parseColor = (color) => {
  const match = color.match(/[\d.]+/g);
  assert.ok(match && match.length >= 3, `colore CSS non riconosciuto: ${color}`);
  const [r, g, b] = match.slice(0, 3).map(Number);
  const a = match.length >= 4 ? Number(match[3]) : 1;
  return { r, g, b, a };
};

// Sfondo effettivo: risale gli antenati fondendo gli sfondi semi-trasparenti.
const effectiveBackground = async (locator) => {
  const stack = await locator.evaluate((el) => {
    const out = [];
    let node = el;
    while (node && node !== document.documentElement) {
      out.push(getComputedStyle(node).backgroundColor);
      node = node.parentElement;
    }
    out.push(getComputedStyle(document.body).backgroundColor);
    out.push(getComputedStyle(document.documentElement).backgroundColor);
    return out;
  });
  let acc = null;
  for (const raw of stack) {
    const c = parseColor(raw);
    if (c.a === 0) continue;
    if (!acc) {
      acc = c;
    } else if (acc.a < 1) {
      const a = acc.a + c.a * (1 - acc.a);
      acc = {
        r: (acc.r * acc.a + c.r * c.a * (1 - acc.a)) / a,
        g: (acc.g * acc.a + c.g * c.a * (1 - acc.a)) / a,
        b: (acc.b * acc.a + c.b * c.a * (1 - acc.a)) / a,
        a,
      };
    }
    if (acc.a >= 1) break;
  }
  assert.ok(acc, 'nessuno sfondo opaco trovato');
  return acc;
};

const luminance = ({ r, g, b }) => {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const contrastRatio = (fg, bg) => {
  const lf = luminance(fg);
  const lb = luminance(bg);
  return (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
};

const hueOf = ({ r, g, b }) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
};

const assertTextContrast = async (page, textSel, label, min = 4.5) => {
  const el = page.locator(textSel);
  const fg = parseColor(await el.evaluate((n) => getComputedStyle(n).color));
  const bg = await effectiveBackground(el);
  const ratio = contrastRatio(fg, bg);
  assert.ok(
    ratio >= min,
    `${label}: contrasto ${ratio.toFixed(2)} < ${min} (fg=${JSON.stringify(fg)}, bg=${JSON.stringify(bg)})`,
  );
};

// Sonda con le classi reali dell'app: card glass-panel, testo muted, input,
// tabella con celle sticky bg-background, badge semantici e overlay dialog.
const injectProbe = (page) =>
  page.evaluate(() => {
    document.getElementById('contrast-probe')?.remove();
    const host = document.createElement('div');
    host.id = 'contrast-probe';
    host.innerHTML = `
      <div class="glass-panel shadcn-card rounded-xl text-card-foreground p-6" id="probe-card">
        <div id="probe-title" class="text-2xl font-semibold">Titolo di prova</div>
        <div id="probe-muted" class="text-sm text-muted-foreground">Descrizione secondaria</div>
        <input id="probe-input" class="rounded-md border border-input bg-background px-3 py-2 text-sm" value="Valore campo" />
        <span id="probe-badge-blue" class="inline-flex rounded border bg-blue-500/10 text-blue-700">Badge blu</span>
        <span id="probe-badge-green" class="inline-flex rounded border bg-green-500/10 text-green-700">Badge verde</span>
        <span id="probe-badge-red" class="inline-flex rounded border bg-red-500/10 text-red-700">Badge rosso</span>
        <div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr>
          <th id="probe-th" class="h-12 px-4 text-left font-medium text-muted-foreground sticky left-0 bg-background">Colonna</th>
        </tr></thead><tbody><tr class="border-b">
          <td id="probe-td" class="p-4 sticky left-0 bg-background">Cella sticky</td>
        </tr></tbody></table></div>
      </div>
      <div class="glass-overlay rounded-xl p-6 text-popover-foreground" id="probe-overlay">
        <div id="probe-overlay-title" class="text-lg font-semibold">Dialog di prova</div>
        <div id="probe-overlay-muted" class="text-sm text-muted-foreground">Descrizione del dialog</div>
      </div>`;
    document.body.appendChild(host);
  });

const setDarkPrefs = async (pool, session, page, scheme) => {
  await pool.query(
    `UPDATE profiles
        SET ui_prefs = coalesce(ui_prefs, '{}'::jsonb)
          || $2::jsonb
      WHERE id = $1`,
    [session.profileId, JSON.stringify({ theme: 'dark', scheme })],
  );
  await page.evaluate((s) => {
    localStorage.setItem('mystoredesk-theme', 'dark');
    localStorage.setItem('mystoredesk-scheme', s);
  }, scheme);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'), null, { timeout: 15000 });
};

const runDarkAssertions = async (page, label) => {
  await injectProbe(page);

  // Contrasto testi (WCAG >= 4.5) su card, tabella, input, badge, overlay.
  await assertTextContrast(page, '#probe-title', `${label}: titolo card`);
  await assertTextContrast(page, '#probe-muted', `${label}: testo secondario card`);
  await assertTextContrast(page, '#probe-th', `${label}: intestazione tabella`);
  await assertTextContrast(page, '#probe-td', `${label}: cella sticky`);
  await assertTextContrast(page, '#probe-input', `${label}: testo input`);
  await assertTextContrast(page, '#probe-badge-blue', `${label}: badge blu`, 4.5);
  await assertTextContrast(page, '#probe-badge-green', `${label}: badge verde`, 4.5);
  await assertTextContrast(page, '#probe-badge-red', `${label}: badge rosso`, 4.5);
  await assertTextContrast(page, '#probe-overlay-title', `${label}: titolo dialog`);
  await assertTextContrast(page, '#probe-overlay-muted', `${label}: testo secondario dialog`);

  // Celle sticky: superficie card, non trasparente né quasi-nera generica.
  const stickyBg = parseColor(
    await page.locator('#probe-td').evaluate((n) => getComputedStyle(n).backgroundColor),
  );
  assert.ok(stickyBg.a > 0.9, `${label}: la cella sticky ha sfondo opaco`);

  // Bordo card: soft (alpha bassa) e freddo (hue 190–250), non viola netto.
  const cardBorder = parseColor(
    await page.locator('#probe-card').evaluate((n) => getComputedStyle(n).borderTopColor),
  );
  assert.ok(cardBorder.a > 0.05 && cardBorder.a <= 0.45,
    `${label}: bordo card sfumato (alpha=${cardBorder.a})`);
  const cardHue = hueOf(cardBorder);
  assert.ok(cardHue >= 190 && cardHue <= 250,
    `${label}: bordo card freddo, non viola (hue=${cardHue.toFixed(0)})`);

  // Bordo overlay: stessa famiglia fredda, leggermente più presente.
  const overlayBorder = parseColor(
    await page.locator('#probe-overlay').evaluate((n) => getComputedStyle(n).borderTopColor),
  );
  const overlayHue = hueOf(overlayBorder);
  assert.ok(overlayHue >= 190 && overlayHue <= 250,
    `${label}: bordo overlay freddo (hue=${overlayHue.toFixed(0)})`);
  assert.ok(overlayBorder.a >= cardBorder.a,
    `${label}: bordo overlay almeno quanto quello card`);

  // Transizione morbida sui bordi card.
  const transition = await page
    .locator('#probe-card')
    .evaluate((n) => getComputedStyle(n).transitionProperty);
  assert.ok(/border-color/.test(transition), `${label}: transizione bordo card presente (${transition})`);

  // I badge NON riutilizzano il colore del bordo card come segnale di stato.
  const badgeBorder = parseColor(
    await page.locator('#probe-badge-green').evaluate((n) => getComputedStyle(n).borderTopColor),
  );
  assert.notEqual(
    `${Math.round(badgeBorder.r)},${Math.round(badgeBorder.g)},${Math.round(badgeBorder.b)}`,
    `${Math.round(cardBorder.r)},${Math.round(cardBorder.g)},${Math.round(cardBorder.b)}`,
    `${label}: il bordo dei badge resta semantico`,
  );

  // Le card reali della pagina (se presenti) usano lo stesso bordo soft.
  const realPanels = page.locator('.glass-panel:not(#probe-card)');
  if (await realPanels.count()) {
    const realBorder = parseColor(
      await realPanels.first().evaluate((n) => getComputedStyle(n).borderTopColor),
    );
    if (realBorder.a > 0.03) {
      const realHue = hueOf(realBorder);
      assert.ok(realHue >= 190 && realHue <= 250,
        `${label}: bordo card reale freddo (hue=${realHue.toFixed(0)})`);
    }
  }
};

test('Task #476 — contrasto e bordi soft nei due schemi scuri; tema chiaro invariato', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'darkcontrast', organizationName: uniq('Org Contrasto') });
  const browser = await launchBrowser();
  try {
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    // ── Tema chiaro (default): nessuna regola dark applicata ──
    assert.equal(
      await page.evaluate(() => document.documentElement.classList.contains('dark')),
      false,
      'default: tema chiaro attivo',
    );
    await injectProbe(page);
    const lightCardBg = await effectiveBackground(page.locator('#probe-card'));
    assert.ok(luminance(lightCardBg) > 0.5, 'chiaro: superficie card luminosa');
    await assertTextContrast(page, '#probe-title', 'chiaro: titolo card');
    await assertTextContrast(page, '#probe-muted', 'chiaro: testo secondario card');
    const lightMuted = await page
      .locator('#probe-muted')
      .evaluate((n) => getComputedStyle(n).color);
    // In chiaro il testo semantico -700 NON viene rialzato dalle regole dark.
    const lightBadge = parseColor(
      await page.locator('#probe-badge-blue').evaluate((n) => getComputedStyle(n).color),
    );
    assert.ok(luminance(lightBadge) < 0.3, 'chiaro: testo badge blu resta scuro (nessun override dark)');

    // ── Tema scuro standard ──
    await setDarkPrefs(pool, session, page, 'standard');
    assert.equal(
      await page.evaluate(() => document.documentElement.getAttribute('data-skin')),
      null,
      'standard dark: nessuna skin',
    );
    await runDarkAssertions(page, 'scuro standard');
    const darkMuted = await page
      .locator('#probe-muted')
      .evaluate((n) => getComputedStyle(n).color);
    assert.notEqual(darkMuted, lightMuted, 'il tema scuro cambia davvero il testo secondario');

    // ── Midnight Violet ──
    await setDarkPrefs(pool, session, page, 'midnight-violet');
    assert.equal(
      await page.evaluate(() => document.documentElement.getAttribute('data-skin')),
      'midnight-violet',
      'midnight: skin globale attiva',
    );
    await runDarkAssertions(page, 'midnight violet');

    await context.close();
  } finally {
    await browser.close();
    await cleanupOrg(pool, session);
    await pool.end();
  }
});
