---
name: Plafond ricariche per codice dealer
description: Modello contabile del plafond ricariche per codice dealer ("8 miliardi"), non per RS.
---
Il plafond ricariche è per CODICE DEALER (campo codiceDealer nei puntiVendita della Struttura): più POS possono condividere un dealer (stesso saldo), la stessa RS può avere più dealer (saldi separati).

**Regole:**
- Consumo aggregato per POS → risolto a dealer via Struttura; PDV senza dealer = riga RS segnalata `senzaDealer`, MAI attribuito implicitamente.
- Ogni modifica del saldo (`imposta` o `aggiungi`) fotografa `saldoDopo` e apre un nuovo cutoff: vengono scalate solo le vendite ricariche successive, senza ricontare quelle già assorbite.
- Op storiche per RS (codice_dealer NULL): auto-migrate al POST solo se la RS ha UN dealer; altrimenti `daAssegnare` + endpoint di assegnazione che ripunta le righe (append-only, mai duplicare) e rifiuta dealer di un'altra RS (guard rsCanon).
- Org senza alcun dealer configurato: comportamento legacy per RS preservato.
- Operatori: vedono i dealer derivati dai POS con vendite dei propri addetti, non tutti i dealer della RS.

**Why:** il dealer è la chiave contabile reale WindTre; assegnare a dealer di altra RS o attribuire implicitamente sposterebbe plafond tra contabilità diverse.
**How to apply:** qualunque modifica a plafondRicariche/route ricariche-plafond deve mantenere queste invarianti; l'hot-reload del server NON avviene dopo edit a routes.ts — riavviare il workflow prima di testare.
