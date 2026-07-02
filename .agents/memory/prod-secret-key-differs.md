---
name: Prod SMTP_SECRET_KEY differs from dev
description: Secrets destined for the prod DB must be encrypted on the VPS, not locally
---

La `SMTP_SECRET_KEY` di produzione (in `/var/www/incentive-w3/ecosystem.config.cjs`)
è DIVERSA da quella dev (verificato confrontando gli sha256, mai i valori).

**Why:** un segreto cifrato in dev con `encryptSecret` non è decifrabile
dall'app di prod: il decrypt fallisce in silenzio (`decryptSecret` ⇒ null)
e la feature sembra "non configurata" senza errori evidenti.

**How to apply:** per scrivere un segreto cifrato nel DB di prod
(es. `organization_config.config.*` con `bot_token`/`client_secret`),
cifra SUL VPS con un node one-liner che legge la chiave dall'ecosystem
config, e verifica il round-trip confrontando lo sha256 del decrypt col
valore atteso. Passa il plaintext via stdin (mai su command line né in
heredoc: un heredoc su ssh consuma lo stdin e rompe `$(cat)`).
