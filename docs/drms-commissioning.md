# DRMS Commissioning Dashboard

Sezione admin-only sotto `/drms-commissioning` per analizzare l'Excel WindTre
DRMS (Estratto conto provvigionale) esportato mensilmente. Gli upload sono
persistiti in `drms_uploads` per organizzazione+mese (latest wins via overwrite
confirm su conflitto).

## Logica
- Excel parsing (SheetJS) client-side: legge sheet `Estratto conto`, rileva
  il periodo dal valore più frequente di `COMPETENZA` (es. "MAR-26"),
  classifica ogni riga su 13 capitoli (Energia, Mobile, Fisso, Partnership
  Reward, CB, PR Assicurazioni, Extra PR Energia, Assicurazioni, Reload,
  SOS Caring, PR Reload, Pinpad, Ass. Tecnica). Righe non matchate vanno
  in "Altro".
- Regole di classificazione in `client/src/lib/drmsClassifier.ts`:
  `classificaRiga(row, periodComp)` valuta 9 regole ordinate — ASSTTCN,
  PR Reload set, PR Assicurazioni, SOS Caring, override speciale
  PC ADJUSTMENT MANUALI (regex su DESCRIZIONE_ITEM), PR Customer Base set
  (in-period → Partnership Reward, out-of-period → Extra PR Energia),
  Reload set, CB attivazione per Mobile/Fisso non-PR, infine mapping base
  TIPO_FONIA.

## UI
4 tab dashboard:
- **Overview**: KPI + ripartizione
- **Matrix**: PV × capitolo heatmap
- **Driver**: drill-down per capitolo
- **PV**: search + per-store metriche Mobile (Tied/Untied/MNP/MIB/soglia) e
  Fisso (FTTH/FWA/LNA/LA/convergenti/soglia), deduplicato sui contratti
  contrattuali in periodo.

## API
- `GET /api/drms` (list)
- `GET /api/drms/by-period?month&year`
- `GET /api/drms/:id`
- `POST /api/drms` (409 + `existingId` su conflitto, accetta `overwrite=true`)
- `DELETE /api/drms/:id`

Tutti gated da `requireAdminRole` con check di org-ownership.
