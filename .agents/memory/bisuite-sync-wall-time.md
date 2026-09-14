---
name: BiSuite sync wall time
description: Semantica non standard dei timestamp legacy usati per mostrare l'ultimo aggiornamento BiSuite
---

**Regola:** i timestamp legacy di sincronizzazione BiSuite contengono già l'ora locale registrata, anche quando la serializzazione API termina con `Z`; la UI deve preservarne le cifre usando un formatter UTC.

**Why:** convertirli nuovamente con `Europe/Rome` aggiunge una seconda volta l'offset e mostra un orario avanti di due ore nel periodo estivo.

**How to apply:** questa eccezione vale per `fetchedAt`/`lastSync` legacy. Non generalizzarla agli istanti reali dell'app, che devono continuare a essere convertiti normalmente nel fuso desiderato.