---
name: CJ later purchases — prod diagnosis
description: What the prod data said when "July SIM customers show no later purchases" was reported; how to re-check fast.
---

Rule: prima di toccare il reconcile Customer Journey per "gli acquisti successivi non compaiono",
verifica su prod con SELECT: la pipeline fetch→last_seen_at→watermark→reconcile agganciava
correttamente gli acquisti di ago/set alle journey di luglio (stesso CF/P.IVA normalizzato).

**Why:** la percezione "maturato fermo" derivava dal fatto che il cross-sell nei mesi successivi è
raro (~3% delle journey di luglio) e che molti acquisti successivi sono categorie NON tracciate
(RICARICHE, ASSISTENZA, ACCESSORI, SIM sola, MIA TIED, MODEM) che per design non generano item.
Le vendite senza CF/P.IVA in prod sono clienti anonimi (codiceEsterno "0", quasi solo ricariche).

**How to apply:**
- Query rapida: July journeys con `customer_key` presente in vendite >= ago vs quelle con item >= ago.
- Il reconcile riporta `skippedNoIdentity` / `skippedNoIdentityWithDriver` (log post-fetch + toast
  "Rigenera"): se il secondo cresce, c'è davvero perdita di contratti.
- Il reconcile è la fonte di verità derivata dalle vendite locali: journey/item non derivabili
  vengono potati (per org, sotto lock). Lezione per i test: NON seminare journey a mano in un'org
  che ha anche bisuite_sales, oppure marca il watermark come allineato prima di caricare la lista.
- Il watermark va catturato PRIMA della SELECT delle vendite (race con fetch concorrente).
- Verifica rapida post-deploy senza aspettare il fetch delle 22:00: `scripts/verify-cj-later-purchases-prod.mts`
  via tunnel (stesso reconcile dello scheduler + SELECT luglio→acquisti successivi). Baseline 4 set 2026:
  1423 journey luglio, 44 con acquisto successivo; scartate-senza-identità ~9800 di cui 51 con pista tracciata.
