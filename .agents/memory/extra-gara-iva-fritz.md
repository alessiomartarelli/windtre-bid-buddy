---
name: Extra Gara IVA e FRITZ
description: Regola punti delle linee Fisso P.IVA e del bonus FRITZ nella Extra Gara IVA
---

Ogni prima o seconda linea Fisso P.IVA vale 1 punto nella Extra Gara IVA. Un FRITZ associato sullo stesso articolo/vendita aggiunge 0,5 punti alla linea; non è una fonte di punti autonoma e ogni linea può ricevere al massimo un bonus FRITZ.

**Why:** la regola commerciale assegna lo stesso punto base a entrambe le linee e considera FRITZ soltanto come maggiorazione della linea. Limitare i FRITZ sul totale PDV non basta: un FRITZ consumer potrebbe altrimenti consumare il bonus di una linea P.IVA distinta.

**How to apply:** preservare un riferimento per articolo/vendita dalla mappatura al calcolo e contare il bonus solo sulla linea P.IVA che contiene il segnale FRITZ; massimo uno per linea. Il fallback aggregato vale solo per input legacy privi di riferimenti.