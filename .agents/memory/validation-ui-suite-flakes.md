---
name: Parallel validation UI-suite flakes
description: Full task-completion validation runs all Playwright suites in parallel against one Vite dev server; random suites time out on page.goto networkidle.
---

**Rule:** When task-completion validation fails only with `page.goto: Timeout 30000ms (networkidle)` in a few random UI suites (different ones per run), it's parallel-load flakiness, not a regression.

**Why:** ~20 Playwright suites all hit the single Vite dev server concurrently; cold module transforms + load make first navigation exceed 30s.

**How to apply:** Re-run each failed suite individually (`bash scripts/run-<suite>.sh`) — if they pass, retry validation once; if the full run keeps flaking, complete with `skip_validation_reason` documenting the individual passes plus typecheck and the suite covering your change.
