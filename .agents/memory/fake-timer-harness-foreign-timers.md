---
name: Fake-timer harness & suite col pool Postgres
description: Isolamento dei test con setTimeout fintato e uscita esplicita delle suite che importano storage.
---

# Fake-timer harness e timer estranei

Regola: un harness che sostituisce `globalThis.setTimeout` cattura anche timer estranei (es. pg-pool arma un "remove idle client" in momenti non deterministici). Gli assert su "quanti timer attivi" devono identificare i timer del componente sotto test in modo deterministico (es. dal callback della sua closure), non contare tutto ciò che è stato catturato né usare soglie sul delay (time-dependent).

Regola 2: se il componente sotto test fa query DB, mocka TUTTI i metodi storage che tocca — una sola query reale sfuggita basta a rendere la suite dipendente dall'ambiente (pool attivo, timer estranei, lentezze).

Regola 3: i file di test che importano `server/storage` creano il pool Postgres; con handle vivi Node non esce da solo a fine suite. Chiudi con un `process.exit` esplicito anche in caso di successo, o la run verde resta appesa (timeout in CI).

**Why:** i test reschedule/recovery dello scheduler Telegram flakavano perché contavano un timer pg-pool catturato dal fake setTimeout (originato da un metodo storage non mockato), e dopo il fix la suite verde restava appesa perché usciva solo su failure.

**How to apply:** ogni suite con fake timers globali e/o import di storage: identificazione deterministica dei timer contati, mock completo dello storage toccato, exit esplicito finale.
