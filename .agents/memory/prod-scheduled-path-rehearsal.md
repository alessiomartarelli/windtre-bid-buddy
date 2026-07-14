---
name: Prod scheduled-path dress rehearsal
description: How to verify a prod scheduler path (sync→aggregate→send) without waiting for the timer
---

Rule: quando un percorso schedulato di prod va verificato prima dell'orario, non aspettare il timer e non modificare gli orari in prod — esegui le STESSE funzioni dello scheduler da dev contro il DB di prod.

**Why:** il pulsante di test manuale spesso copre un percorso ridotto (es. salta la sync); solo invocare la stessa catena dello scheduler prova davvero decrypt token + sync + aggregazione + invio.

**How to apply:** tunnel SSH al Postgres del VPS (`ssh -f -N -L <port>:localhost:5432`), recupera `DATABASE_URL` e `SMTP_SECRET_KEY` di prod in variabili shell SENZA stamparle, poi `npx tsx` di uno script che importa le funzioni server (tsx risolve gli alias `@shared` via tsconfig quando lanciato come `npx tsx`, a differenza dei test con loader). Chiudi il tunnel a fine run (il trap EXIT non uccide l'ssh -f: verifica con ps). Esempio: `scripts/verify-telegram-scheduled-path.mts`.

Nota tunnel: un tunnel `ssh -f -N` NON sopravvive tra chiamate bash separate del tool — apri tunnel e client nella STESSA chiamata (`ssh -N -L ... & TPID=$!; ...; kill $TPID`). E mai `pkill -f "<porta>"`: il pattern matcha la bash corrente e la uccide (exit 143).
