---
name: XLSX readFile not available in ESM/tsx
description: How to read .xlsx files in node ESM tests/scripts loaded via tsx
---

`XLSX.readFile(path)` from the `xlsx` package is NOT available when the module
is imported via ESM (`import * as XLSX from "xlsx"`) under the `tsx` loader —
calling it throws `TypeError: XLSX.readFile is not a function`.

**How to apply:** read the file yourself and parse the buffer:
```js
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
const wb = XLSX.read(readFileSync(path), { type: "buffer" });
const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
```
**Why:** the ESM build only exposes the core (`read`/`utils`); the fs-backed
`readFile`/`writeFile` helpers are in the CommonJS entry and tree-shaken out.
Used by tests/incentivazione.test.mjs (valenze Excel parsing).
