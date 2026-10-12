---
name: PDF content assertions in UI tests
description: How to assert text content inside jsPDF/autotable exports in Playwright tests
---

Rule: verify export PDFs by extracting `(...) Tj` tokens from the uncompressed jsPDF stream (helper `pdfTextTokens` in the pdv-pezzi test files), never by magic bytes alone.

**Why:** magic-byte checks miss missing columns/values; parsing revealed two traps:
- autotable header cells wrap **mid-word** ("Wi nd tre Pr ot ett i") → match headers on the space-stripped joined text (`joined.replace(/\s+/g,'').includes('WindtreProtetti')`), never with `\s+` between words.
- zero/empty cells differ per component: the Dashboard tabella (`cellPair`) emits **empty tokens** for missing cells (so numeric sequences skip zero columns), while the Vendite component emits literal `"0"` tokens. Anchor row checks on an RS-name token that fits its column width (PDV codes can wrap mid-token) and count only the columns actually emitted.

**How to apply:** any test asserting content of a jsPDF/autotable export (tabella PDV × Pista Pezzi/Punti, premi RS, etc.).

For readability checks, parse the downloaded PDF with a real PDF reader and
inspect text positions and font sizes; token presence alone is insufficient.

**Why:** a long table row can preserve every token while splitting the
identifying columns from the references onto another page. Repeated headers
do not restore that association.

**How to apply:** for multipage provenance tables, verify that each row's
identity, role, and references occur on the same page whenever the row fits
within one page, alongside clipping/font-size checks and a rendered-page review.
