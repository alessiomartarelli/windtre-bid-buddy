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

- Campi di esito: dal Task "stato economico da DRMS" `classifyAndNormalize`
  conserva su ogni riga anche `FISCAL_CODE`, `P_IVA_CLIENTE`, `POD_PDR`,
  `CAUSALE_STORNO`, `DATA_EVENTO`, `TIPO_TRANSAZIONE`, `DT_ATTIVAZIONE` (non
  concorrono ai capitoli: servono al motore di esito Customer Journey,
  `shared/customerJourneyDrms.ts`). Gli upload salvati PRIMA sono "legacy":
  le righe non hanno quelle chiavi e non sono ricostruibili dal DB. La lista
  `GET /api/drms` espone `hasOutcomeFields` (calcolato in SQL sul jsonb:
  almeno una riga con una delle chiavi, upload vuoto = ok); la landing mostra
  un banner ambra con i file/periodi da ricaricare e un badge "senza esito"
  sulla riga. Ricaricare lo stesso file (merge per SEQ_ID) aggiorna le righe e
  ricalcola l'esito. Ogni `POST /api/drms` risponde anche con `cjOutcomes`
  (riepilogo esito CJ, incl. `legacyUploads`) e il client lo riporta nel toast.

## UI
4 tab dashboard:
- **Overview**: KPI + ripartizione
- **Matrix**: PV × capitolo heatmap
- **Driver**: drill-down per capitolo
- **PV**: search + per-store metriche Mobile (Tied/Untied/MNP/MIB/soglia) e
  Fisso (FTTH/FWA/LNA/LA/convergenti/soglia), deduplicato sui contratti
  contrattuali in periodo.

## API
- `GET /api/drms` (list, con `hasOutcomeFields`)
- `GET /api/drms/by-period?month&year`
- `GET /api/drms/:id`
- `POST /api/drms` (409 + `existingId` su conflitto, accetta `overwrite=true`)
- `DELETE /api/drms/:id`

Tutti gated da `requireAdminRole` con check di org-ownership.
