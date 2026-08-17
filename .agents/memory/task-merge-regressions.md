---
name: Task merge regressions
description: Automated task-agent merges can reintroduce old component versions, inject stray hint lines, and land test suites with stale semantics.
---

Rule: after an automated task merge, verify that redesigned components weren't reverted and that merged test suites still match current semantics.

**Why:** a merge overwrote a redesigned dashboard component with its pre-redesign version, injected spurious "hint"/confidence text lines into the page source, and landed a suite asserting a KPI's old meaning (revenue) after another task had redefined it (sum of gara premi) — page broke and suites conflicted.

**How to apply:**
- The pre-merge state is preserved on `gitsafe-backup/main` — extract the good component block from there rather than rewriting it.
- Grep the merged files for stray non-code text (e.g. "hint:", "confidence:") and remove it.
- When two merged suites assert conflicting semantics for the same UI, decide which task's semantics won (usually the later redesign) and update the stale suite's seed/expectations instead of weakening asserts.
- Also check `index.css` (and other shared files) for dead CSS left over from replaced designs.
