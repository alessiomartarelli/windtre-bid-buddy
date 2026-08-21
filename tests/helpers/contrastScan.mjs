// Scanner contrasto WCAG condiviso fra le suite dark-contrast (Task #482/#484).
// Percorre tutti gli elementi con testo diretto visibile dentro `rootSel` e
// calcola il rapporto di contrasto WCAG fra colore testo (composto con
// l'opacità effettiva) e sfondo effettivo (fusione degli sfondi
// semi-trasparenti degli antenati). Ritorna le violazioni.
// Esclusioni prudenti (non verificabili o legittime per WCAG):
//   - elementi disabilitati (disabled / aria-disabled);
//   - antenati con background-image (gradienti: sfondo non calcolabile);
//   - testo trasparente (decorativo, es. background-clip:text).
import assert from 'node:assert/strict';

export const scanContrast = (page, rootSel) =>
  page.evaluate((sel) => {
    const parse = (raw) => {
      const m = raw.match(/[\d.]+/g);
      if (!m || m.length < 3) return null;
      const [r, g, b] = m.slice(0, 3).map(Number);
      return { r, g, b, a: m.length >= 4 ? Number(m[3]) : 1 };
    };
    const lum = ({ r, g, b }) => {
      const lin = (v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (f, bg) => {
      const lf = lum(f);
      const lb = lum(bg);
      return (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
    };
    const blendOver = (top, bottom) => {
      const a = top.a + bottom.a * (1 - top.a);
      return {
        r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
        g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
        b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
        a,
      };
    };

    const root = document.querySelector(sel);
    if (!root) return { missingRoot: true, violations: [] };

    const violations = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let el = root; el; el = walker.nextNode()) {
      if (!(el instanceof HTMLElement)) continue;
      // Solo elementi con testo DIRETTO non vuoto.
      const direct = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join('')
        .trim();
      if (!direct) continue;

      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;

      // Disabilitato = esenzione WCAG.
      if (el.closest('[disabled], [aria-disabled="true"], [data-disabled]')) continue;

      // Opacità effettiva (prodotto degli antenati) composta nel colore testo.
      let opacity = 1;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        opacity *= Number(getComputedStyle(n).opacity || 1);
      }
      const fgRaw = parse(cs.color);
      if (!fgRaw) continue;
      let fg = { ...fgRaw, a: fgRaw.a * opacity };
      if (fg.a <= 0.01) continue; // testo trasparente/decorativo

      // Sfondo effettivo: fusione risalendo gli antenati.
      let bg = null;
      let unknown = false;
      let node = el;
      const chain = [];
      while (node) {
        chain.push(node);
        node = node.parentElement;
        if (!node && chain[chain.length - 1] !== document.documentElement) {
          chain.push(document.body, document.documentElement);
          break;
        }
      }
      for (const n of chain) {
        if (!n) continue;
        const ncs = getComputedStyle(n);
        const c = parse(ncs.backgroundColor);
        if (ncs.backgroundImage && ncs.backgroundImage !== 'none') {
          // Gradiente/immagine: sfondo non calcolabile in modo affidabile.
          if (!bg || bg.a < 1) unknown = true;
          break;
        }
        if (c && c.a > 0) {
          bg = bg ? blendOver(bg, c) : c;
          if (bg.a >= 0.999) break;
        }
      }
      if (unknown || !bg) continue;
      if (bg.a < 0.999) bg = blendOver(bg, { r: 255, g: 255, b: 255, a: 1 });

      // Testo semi-trasparente: componilo sopra lo sfondo.
      if (fg.a < 1) fg = blendOver(fg, bg);

      const size = parseFloat(cs.fontSize) || 16;
      const weight = Number(cs.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.5 && weight >= 700);
      const min = large ? 3.0 : 4.5;
      const r = ratio(fg, bg);
      if (r < min) {
        violations.push({
          ratio: Number(r.toFixed(2)),
          min,
          text: direct.slice(0, 60),
          testid: el.closest('[data-testid]')?.getAttribute('data-testid') || null,
          tag: el.tagName.toLowerCase(),
          cls: (el.className && String(el.className).slice(0, 120)) || '',
          fg: `rgb(${Math.round(fg.r)},${Math.round(fg.g)},${Math.round(fg.b)})`,
          bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        });
      }
    }
    return { missingRoot: false, violations };
  }, rootSel);

export const assertPageContrast = async (page, label, { rootSel = 'main, body', waitSel }) => {
  await page.waitForFunction(
    () => document.documentElement.classList.contains('dark'),
    null, { timeout: 15000 },
  );
  if (waitSel) await page.locator(waitSel).first().waitFor({ state: 'visible', timeout: 30000 });
  // Piccola attesa per render post-fetch (grafici/tabelle virtualizzate).
  await page.waitForTimeout(500);

  const root = (await page.locator('main').count()) ? 'main' : 'body';
  const { violations } = await scanContrast(page, rootSel === 'main, body' ? root : rootSel);
  assert.equal(
    violations.length,
    0,
    `${label}: ${violations.length} violazioni di contrasto:\n` +
      violations
        .map((v) => `  - [${v.testid ?? v.tag}] "${v.text}" ratio=${v.ratio} (min ${v.min}) fg=${v.fg} bg=${v.bg} cls="${v.cls}"`)
        .join('\n'),
  );
};
