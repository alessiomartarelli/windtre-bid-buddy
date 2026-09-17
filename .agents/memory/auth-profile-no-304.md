---
name: Auth profile must not return 304
description: Perché la route del profilo di sessione deve disabilitare cache ed ETag condizionali
---

**Regola:** la risposta del profilo di sessione deve essere sempre un 200 con body per una sessione valida e deve dichiarare `no-store`; anche il client deve richiederla con cache disabilitata.

**Why:** più componenti possono creare istanze indipendenti dell’hook auth. Se una richiesta riceve 304, Fetch la considera una risposta senza body e non `ok`; quell’istanza azzera il profilo mentre le altre restano autenticate, causando lampeggi e falsi messaggi di accesso negato.

**How to apply:** non abilitare caching condizionale sulle route auth correnti. I componenti protetti devono inoltre distinguere “profilo in caricamento” da “profilo caricato senza ruolo”.