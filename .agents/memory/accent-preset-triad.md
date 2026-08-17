---
name: Accent preset triad
description: A new accent/theme preset must be registered in client runtime, pre-paint table, and server whitelist together.
---
Un preset accent esiste in tre registri che devono restare in lockstep: la lista client runtime, la tabella pre-paint dell'HTML e la whitelist condivisa lato server.
**Why:** la whitelist server rifiuta SILENZIOSAMENTE le preferenze con id sconosciuto (nessun errore, la scelta semplicemente non persiste) — il colore sembra applicato in sessione ma sparisce.
**How to apply:** quando si aggiunge/rinomina un preset o si debugga "il colore non si salva": verificare tutti e tre i registri e riavviare il server, che non ricarica il codice condiviso a caldo.
