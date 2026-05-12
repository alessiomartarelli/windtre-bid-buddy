# Struttura Organizzazione: CRUD RS/PDV (admin)

La tab `/admin → Struttura` è editabile per `admin`/`super_admin` (sempre
read-only per `operatore`). Tutte le mutazioni persistono in
`organization_config.puntiVendita` e propagano cross-modulo.

- **Authz hardening** su `PUT /api/organization-config`: il legacy write
  path rifiuta `403` se un utente non admin tenta di modificare le chiavi
  protette `puntiVendita`/`ragioniSociali` (diff vs config corrente; le
  altre parti della config restano scrivibili da operatore).

## Endpoint
Gated `requireAdminRole` + scoping su `organizationId`:
- `POST /api/admin/struttura/ragione-sociale` — crea RS vuota (name-only).
  Materializza in `cdg_ragioni_sociali` per visibilità immediata in CdG.
- `POST /api/admin/struttura/pdv` — crea PDV (codicePos univoco
  case-insensitive nell'org).
- `PUT /api/admin/struttura/pdv` — modifica PDV (match per
  `(rs, codicePos)` originali). Su rename `codicePos` propaga a
  `cdg_spese.pdv_codice` e `cdg_pdv_manuali`. Su rename RS propaga su
  `cdg_*`.
- `DELETE /api/admin/struttura/pdv?rs=&codice=` — elimina PDV.
- `POST /api/admin/struttura/pdv/bulk` — usato dai banner di sync (PDF
  Configurazione Gara + Preventivatore wizard) per aggiungere PDV mancanti
  in massa, ritorna `{added, skipped}`.
- `PUT /api/admin/struttura/ragione-sociale/:nome` — rinomina RS (409 se
  target già esiste). Cascade rename su `cdg_categorie/fornitori`
  (`array_replace` su colonna `ragioniSociali text[]`),
  `cdg_pdv_manuali`, `cdg_spese`, `cdg_ragioni_sociali`.
- `DELETE /api/admin/struttura/ragione-sociale/:nome` — elimina RS + tutti
  i PDV figli + cascade su `cdg_*`.

Helper inline in `server/routes.ts` (~2424-2660): `readPv`/`writePv`
preservano `configVersion`; `findCodiceClash` controlla unicità globale
case-insensitive.

## UI
`client/src/pages/AdminPanel.tsx` Struttura tab espone bottoni Nuova RS,
Rinomina/Elimina RS, Nuovo PDV per RS, Modifica/Elimina PDV; dialog form
con cluster Mobile/Fisso/CB, canale, tipoPosizione.

## Banner sync incongruenze (consenso esplicito admin)
- `ConfigurazioneGara.tsx`: CTA "Aggiungi N alla struttura" sopra la
  tabella unmatched del PDF di gara, gated `isAdminOrSuper`.
- `Preventivatore.tsx`: componente `PdvStrutturaBanner` mostrato sopra
  `StepPuntiVendita` (step 1) quando i PDV del wizard contengono codici
  non presenti nella struttura canonica. Per admin: bottone "Aggiungi
  alla struttura" → bulk POST. Per operatore: messaggio informativo.

## Wizard storage scoping (data leak fix)
Le chiavi `localStorage` del wizard Preventivatore (`preventivatore-state`,
`preventivatore-template`, `preventivatore-config`) sono scoped per
`organizationId` (suffix `:${orgId}`). Il hook `usePreventivatoreStorage(orgId)`
in `client/src/hooks/use-preventivatore-storage.ts` accetta orgId, è no-op
finché auth non è caricata, e cancella in mount le vecchie chiavi globali
legacy (`purgeLegacyUnscopedKeys`). `Preventivatore.tsx` passa
`useAuth().profile.organizationId` e gate l'init effect su `storageReady`.
Senza questo scoping, in browser usato da più organizzazioni TEST poteva
caricare PDV/config di un'altra org dal localStorage residuo.
