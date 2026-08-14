---
name: RS alias resolution
description: Invarianti dell'unificazione varianti Ragione Sociale (alias + normalizzazione)
---

- Unica normalizzazione condivisa client+server (`shared/ragioneSociale.ts`); non reintrodurre normalizzazioni locali.
- Alias risolti SOLO in lettura/aggregazione: i dati storici non si riscrivono mai; rimuovere un alias ri-separa i gruppi.
- **Precedenza resolver**: alias prima, nomi canonici set-se-assente.
- **Why:** la variante alias esiste spesso anche come anchor 'auto' nel registro RS (portatore di id); se i canonici sovrascrivessero, l'anchor "ruberebbe" la risoluzione all'alias.
- **How to apply:** ogni nuovo read-path che mostra/aggrega RS deve passare dal resolver org-scoped; create/rename di RS deve rifiutare nomi che collidono (normalizzati) con alias altrui, e alias che collidono con nomi manuali o alias altrui. La route delle RS ereditate deve creare l'anchor anche con P.IVA/note vuote quando ci sono alias da salvare.
