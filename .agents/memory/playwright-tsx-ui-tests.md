---
name: Playwright UI tests in this repo
description: How to write a browser UI validation test (node:test + tsx + playwright-core + system chromium) here
---

Browser UI tests run as `node --import tsx --test tests/*.test.mjs`, registered as a
validation step via a `scripts/run-*.sh` wrapper (same pattern as the other cj tests).

**Rule:** prefer pure-logic tsx tests; only reach for Playwright when the thing under
test is React rendering the pure logic can't reach (e.g. a `useState` expand/collapse
toggle, column projection). UI tests are ~25s vs ~1s for pure ones.

**How to apply / gotchas:**
- Use `playwright-core` (npm) + system `chromium` (Nix). Resolve the executable at
  runtime: `execSync('which chromium-browser || which chromium')` — the `/nix/store`
  path changes across rebuilds, never hardcode it. Honor `CHROMIUM_PATH` override.
- Launch args required in the container: `--no-sandbox --disable-dev-shm-usage --disable-gpu`.
- Auth without the login UI: HTTP `POST /api/auth/signup` (201, returns `{id, organization:{id}}`
  + Set-Cookie), grab the first `name=value` from `headers.getSetCookie()`, inject via
  `context.addCookies([{name,value,domain:'localhost',path:'/'}])`, then `page.goto` directly.
- Seed/cleanup the dev DB directly via `pg` Pool on `DATABASE_URL` (deterministic, no reconcile).
  Routes re-read the profile each request, so operator-isolation tests can `UPDATE profiles
  SET role=..., bisuite_addetti=$arr::text[]` then reload the page.
- The wrapper script must wait for `localhost:5000` (app workflow must be running) before
  launching, like the other run-*.sh scripts.
- Incentivazione interna page opens on the CURRENT month/year by default, so seed
  `incentivazione_valenze` for `new Date()`'s month/year (not a fixed date) or the page
  shows no cards. Config need NOT be seeded — the page uses `defaultConfig` (W3/Vodafone
  sections already `ready`). Sort-by-pista order is deterministic regardless of the
  calendar because the sort key is the raw valenza value (`actual`), not the projection.
