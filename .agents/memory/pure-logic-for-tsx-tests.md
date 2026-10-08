---
name: Pure logic in shared/ for tsx unit tests
description: How to make UI/export/calc logic unit-testable without a dev server, DB, or runtime React/jsPDF/xlsx.
---

# Pure logic extraction for `tsx` unit tests

The repo's `*.test.mjs` suites run with `node --import tsx --test` and import TS
modules directly. Keep pure logic free of runtime React, lucide-react, jsPDF,
and xlsx, and `tsx` does NOT resolve the `@shared`/`@/` path aliases at runtime.

**Rule:** put the pure, testable logic in a module that uses only RELATIVE
imports and `import type` for anything alias-pathed; then have the heavy
rendering/UI file consume it.

**Why:** importing a module that has a runtime `@shared/...` or `@/...` import,
or that transitively imports lucide-react / jsPDF / react-dom, breaks the test
loader (alias unresolved, or DOM/runtime deps missing).

**How to apply:**
- Extract into `shared/<topic>.ts` (relative imports to other `shared/` files,
  `import type` from `./schema`). Test imports it via relative path
  `../shared/<topic>.ts`. Examples: `shared/customerJourney.ts`,
  `shared/customerJourneyExport.ts`, `shared/incentivazione.ts`.
- Or extract into `client/src/lib/<topic>.ts` using ONLY `import type` (no
  runtime imports). Example: `client/src/lib/customerJourneyTimeline.ts`.
- If a runtime constant lives in a file that imports lucide (e.g. the driver
  emoji map used by exports lived in `customerJourneyIcons.ts`), move that
  constant into the pure `shared/` module so the test never loads lucide.
- Register a runner `scripts/run-<topic>-tests.sh` and a validation step.

## Testing the actual Excel file

**Rule:** for XLSX content verification, a separate adapter with relative imports
may load SheetJS in Node. Serialize with `XLSX.write` and read the resulting
buffer with `XLSX.read`; neither requires a browser. Keep `writeFile` download
calls outside the workbook builder.

**Why:** testing only pure row objects cannot catch serialization mistakes such
as numbers becoming text, missing empty-sheet headers, or damaged identifier
strings. The runtime dependency restriction applies to pure logic, not to an
explicit file-format integration test.

**How to apply:** use pure shared sheet definitions plus a DOM-free workbook
adapter; assert the read-back cells and types without launching UI tests.
