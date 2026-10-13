---
name: Smartphone CJ e SIM aggiuntive
description: Decisione commerciale dell'utente sui telefoni associati a una SIM successiva
---

Una vendita successiva dello stesso cliente con nuova SIM B e smartphone abbinato all'ICCID di B genera un extra di 20 €, anche quando B è diversa dalla SIM A iniziale. Non si apre una CJ distinta per ogni SIM.

**Why:** l'utente ha confermato esplicitamente questo caso commerciale; richiedere l'ICCID iniziale anche agli extra escluderebbe acquisti che vuole riconoscere.

**How to apply:** distinguere sempre la pista Smartphone della CJ iniziale dalle coppie aggiuntive. Non estendere la decisione ai premi smartphone di Gara, Vendite o Canvass.

La finestra commerciale della CJ è solare, inclusiva da T0 a T5. Una SIM successiva non riavvia T0; la finestra degli esiti DRMS è indipendente e non cambia con questa regola.

**Why:** la scelta confermata è una sola journey per cliente, con T0–T5 per cliente, lasciando invariato l'orizzonte DRMS.

**How to apply:** mantieni il T0 della journey originaria anche per SIM successive e aggiorna insieme calcolo, validità, timeline, etichette ed export; non accorciare né spostare la finestra DRMS.

Il conteggio dei rami SIM richiesto dall'utente comprende un ramo iniziale
per anagrafica CJ qualificata e un ramo per ogni coppia successiva valida che
sblocca l'extra. Restano separati clienti unici, SIM totali e rami premio.

**Why:** l'utente vuole sapere quanti rami sono stati effettivamente aperti
anche quando una stessa anagrafica genera più premi; sommarli ai clienti unici
falserebbe invece le percentuali di cross-sell.

**How to apply:** includere solo coppie extra ammissibili e deduplicate,
non SIM aggiuntive da sole o telefoni CB abbinati a SIM anteriori alla CJ.

L'ICCID della SIM associata deve essere visibile anche per MOBILE e CB,
non soltanto sotto lo smartphone. I riferimenti commerciali CB non diventano
piste CJ e un dato mancante non va ricavato da un telefono dello stesso cliente.

**Why:** l'utente ha ribadito esplicitamente che la visibilità dell'ICCID non
deve essere limitata agli smartphone.

**How to apply:** distinguere sempre identificativo della SIM, canale
commerciale e ammissibilità al gettone; mantenere il perimetro autorizzato.
