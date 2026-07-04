---
name: Dark mode status & color mapping
description: Dark mode is style-ready but not user-reachable; how to add dark: variants consistently.
---

Dark mode is **not reachable by users**: tailwind `darkMode: ["class"]` + a full `.dark`
palette exist in `client/src/index.css` (blu notte: bg 227 32% 10%, card 227 28% 14%,
primary indaco chiaro), but nothing ever adds the `.dark` class — no toggle, no provider,
no system-preference detection. `next-themes` is a dependency but unused. To preview dark
mode in dev, temporarily add `class="dark"` to `<html>` in `client/index.html` and revert.

**Why:** don't waste time hunting for a theme switch or assume dark mode is live for end
users. If a task needs dark mode usable, a toggle/provider must be added first.

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
