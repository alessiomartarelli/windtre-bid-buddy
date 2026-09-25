---
name: Parallel validation UI-suite flakes
description: Full task-completion validation runs all Playwright suites in parallel against one Vite dev server; random suites time out on page.goto networkidle.
---

**Rule:** When task-completion validation fails only with `page.goto: Timeout 30000ms (networkidle)` in a few random UI suites (different ones per run), or Node's `ERR_WORKER_INIT_FAILED`/`EAGAIN` occurs during test-file loading, check for parallel-load flakiness before attributing it to a regression.

**Why:** Many Playwright suites hit the single Vite dev server concurrently; cold module transforms + load make first navigation exceed 30s. The same concurrency can exhaust OS thread resources while Node starts test-file workers, before the browser semaphore can help.

**How to apply:** Re-run each failed suite individually (`bash scripts/run-<suite>.sh`) — if they pass, retry validation once; if the full run keeps flaking, complete with `skip_validation_reason` documenting the individual passes plus typecheck and the suite covering your change. For Node test suites with several files, `--test-concurrency=1` reduces local worker contention but cannot control parallel validation commands.

**Mitigation in place:** `launchBrowser` in tests/helpers/uiTest.mjs uses a cross-process semaphore (mkdir locks in /tmp/ui-browser-slots, default 3 slots, `UI_BROWSER_SLOTS` to tune) plus 5-attempt exponential-backoff retry on launch failure, so "pthread_create"/browser-launch errors should no longer flake validation. Slots auto-release on browser close/disconnect; stale slots (dead pid or >3 min) get reclaimed.
