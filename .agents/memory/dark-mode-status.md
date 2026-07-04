---
name: Dark mode status & color mapping
description: Dark mode is user-reachable via a theme toggle; how the theme wiring works + dark: variant conventions.
---

Dark mode IS reachable by users. Wiring: tailwind `darkMode: ["class"]` + a full `.dark`
palette in `client/src/index.css` (blu notte: bg 227 32% 10%, card 227 28% 14%, primary
indaco chiaro). A `ThemeProvider`/`useTheme` (`client/src/hooks/useTheme.tsx`) toggles the
`.dark` class on `document.documentElement`; choice (light/dark/system) persists in
localStorage key `mystoredesk-theme`. An inline pre-paint script in `client/index.html`
reads the SAME key and applies `.dark` before first paint to avoid a flash — keep the key
and logic in the script aligned with the provider. The toggle lives in `AppNavbar`
(desktop icon button + mobile menu items). `next-themes` is a dependency but NOT used
(custom provider preferred for CSR flash control).

**Why:** the dark palette + dark: variants are only visible because this switch exists;
don't re-add a toggle/provider. Note the login/`auth` page has no navbar, so no toggle
there by design (it already renders a fixed dark-ish split layout).

**How to apply — dark: variant convention** (add `dark:` NEXT TO the light class, never
replace it; leave inline `style` hex/rgba untouched):
- neutrals: keep the family for neutral/gray/zinc; map to slate for a bluish fit.
  - bg-white / bg-*-50 → dark:bg-slate-900 ; bg-*-100/200 → dark:bg-slate-800 ; 300 → slate-700
  - text 900/black → slate-100 ; 800/700 → slate-200 ; 600 → slate-300 ; 500 → slate-400 ; 400 → slate-500 ; 300 → slate-600
  - border 900 → slate-600 ; 300/200 → slate-700 ; 100 → slate-800
- inverted "solid dark" active controls (bg-neutral-900 text-white) → dark:bg-slate-100 dark:text-slate-900 so they stay a light chip on dark.
- colored badges: text-{c}-700→dark:text-{c}-300, 600→400, 800→200; bg-{c}-50→950, 100→900; border-{c}-200→800.
- saturated -500/-600 colored icons/dots/bars are already legible on dark — leave them.

**Gotcha:** a plain `bg-*` / `text-*` grep misses arbitrary-value backgrounds like
`bg-[#faf8f4]` on page/section root wrappers. If you make the text dark-mode-light but
leave such a wrapper light, you get light-on-light. Always also grep `bg-\[(#|rgb|hsl)`
for light-forcing wrappers and give them a `dark:` variant.
