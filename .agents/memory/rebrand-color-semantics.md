---
name: Rebrand color semantics
description: Nel redesign colori (via arancione WindTre → indaco) quali arancioni sono semantici e vanno mantenuti
---

Regola: dopo il rebrand a palette indaco (task colori 2026-07), l'arancione residuo nel codice NON è un residuo brand da rimuovere — è semantico/di categoria.

**Dove l'arancione è intenzionale:**
- ControlloGestione: delta negativo `text-orange-600` (warning)
- IncentivazioneInterna + incentivazioneExport: indicatore `●live` (#f97316)
- CustomerJourney: stato "annullato"
- MappaturaBiSuite: badge diff/override (warning)
- VenditeBiSuite + shared/bisuiteClassification + venditeReportHtml: categoria Canvass (colore categoria)
- DashboardGaraReale: piste CB arancio vs standard verde (distinzione categoria) + box warning
- WizardSummaryCard: Extra IVA
- incassoUtils: "Buoni"

**Why:** il vincolo era rimuovere l'arancione come colore *brand* WindTre; i colori semantici (warning/categoria/stato) restano leggibili e distinti dal brand indaco.

**How to apply:** in futuri sweep colori o audit "orange", non toccare le occorrenze sopra; il brand è `--brand-indigo` 243 75% 59% (light) / 239 84% 67% (dark), gradienti indigo-500→600, hex #6366f1/#4f46e5.
