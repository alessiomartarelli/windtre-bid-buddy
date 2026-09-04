---
name: CJ dual state (operativo + economico) & DRMS outcome
description: Regole durevoli per i due stati dei contratti Customer Journey e per il motore di esito DRMS; cosa NON fare in reconcile/test.
---
- Ogni item CJ ha DUE stati: `state` operativo (inserito/in_lavorazione/attivato/ko, manuale/BiSuite) e `economicState` (pagato/annullato/stornato/riaccreditato, dal DRMS). Attivo = `isCjItemActive`, mai liste di stati hardcoded.
- **Why:** il DRMS porta solo l'esito economico e non deve mai riscrivere l'avanzamento operativo; l'utente vuole "inserito" che conta come attivo finché non arriva un KO/annullo/storno.
- Il reconcile BiSuite NON deve mai azzerare/sovrascrivere `economicState` (solo COALESCE ad `annullato` per vendite ANNULLATA non manuali). Il DRMS azzera l'economico solo se l'aveva scritto lui (`drmsOutcomeState` valorizzato): così l'annullato BiSuite sopravvive alla cancellazione di un upload.
- Motore (`shared/customerJourneyDrms.ts`): solo righe NATURA=CONTRATTUALE + adjustment "Storno Compensi"; saldo netto per COMPETENZA, percorsa in ordine. Nel DRMS reale `POD_PDR` è valorizzato anche su righe MOBILE/FISSO (numeri spuri): indicizzare i POD SOLO per TIPO_FONIA=ENERGIA o si creano match falsi.
- Stato manuale vince sempre; l'incongruenza è un flag persistito (`drmsMismatch`) ricalcolato ad ogni apply, non derivato in UI.
- Test DB-backed: seminare gli item con INSERT diretti (non via reconcile) e abbassare la trigger date, altrimenti la lista li nasconde; le righe DRMS di test devono avere `IMPORTO_NUM` e `CAPITOLO` come le normalizza il client.
- Migrazione legacy = one-shot idempotente al boot (log "[cj] migrati N item"); le fixture UI che scrivono `state:'annullato'` nel DB dopo il boot restano tollerate da `isCjItemActive`.
