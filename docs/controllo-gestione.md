# Controllo di Gestione

Sezione admin per tracciare spese mensili con doppia data (pagamento per cassa
+ competenza per accrual). Modulo `controllo_gestione` in `shared/modules.ts`,
gated da `requireModule` + ruolo `admin`/`super_admin`.

**Accesso**: tab "Controllo di Gestione" dentro Amministrazione
(`/amministrazione#controllo`). La vecchia rotta top-level
`/controllo-gestione` redirect al tab. `ControlloGestione.tsx` accetta una
prop `embedded` che salta AppNavbar/header container quando renderizzata
dentro Amministrazione.

## Tabelle DB
- `cdg_ragioni_sociali` (per organizzazione, RS **manuali**).
- `cdg_categorie` e `cdg_fornitori` (per `organizationId` + colonna
  `ragioniSociali text[]` **multi-RS**: ogni voce è riutilizzabile su più
  Ragioni Sociali; la vecchia colonna `ragioneSociale` è nullable solo per
  back-compat).
- I PDV sono ereditati read-only da `organization_config.puntiVendita` (la
  vecchia tabella `cdg_pdv` e la colonna `cdg_spese.pdv_id` sono state
  droppate in Task #71).
- `cdg_spese` (FK opzionali a categoria/fornitore con onDelete set null;
  `pdvCodice` varchar = codice PDV; `importo` numeric(14,2) = totale per
  back-compat; `imponibile` + `aliquotaIva` + `iva` numeric nullable per la
  nuova logica IVA; `dataPagamento` date; `meseCompetenza` varchar(7)
  "YYYY-MM").

## RS unificate
`GET /api/cdg/ragioni-sociali/unified` ritorna
`[{nome, origine: "pdv"|"manuale", id?, partitaIva?, note?}]` mergiando
`organization_config.puntiVendita.ragioneSociale` (read-only, badge "da PDV"
in UI) e RS manuali da `cdg_ragioni_sociali` (manuali prevalgono per nome).
La gestione PDV resta in Amministrazione organizzazione.

## Spese — IVA
Il dialog richiede Imponibile (€) + Aliquota IVA (%, preset 0/4/5/10/22 +
"Altro" custom). IVA = `round(imponibile × aliquota / 100, 2 dec in centesimi)`
e Totale = `imponibile + IVA` sono calcolati e mostrati read-only; il backend
(`computeImporti` in `server/cdgRoutes.ts`) ricalcola autoritativamente lato
server e persiste imponibile/aliquotaIva/iva + `importo = totale`
(back-compat). Backfill one-shot al register imposta imponibile=importo,
aliquotaIva=0, iva=0 per le spese pre-esistenti.

## Categorie / Fornitori multi-RS
Insert schemas richiedono `ragioniSociali: string[]` (min 1). DB unique index
canonico `UQ_cdg_cat_org_nome` / `UQ_cdg_forn_org_nome` su
`(organization_id, nome)`: una sola voce per nome per organizzazione,
riusabile su più RS. Backend `cdgStorage.ts` filtra le list per RS via
`${rs} = ANY(ragioniSociali)`; `updateRagioneSociale` rinomina con
`array_replace`; `deleteRagioneSociale` rimuove la RS via `array_remove`
ed elimina solo le righe rimaste senza RS (orfane). Cancellare una RS NON
cancella categorie/fornitori condivisi con altre RS. Pre-check friendly su
POST/PUT (`findCategoriaOverlap` / `findFornitoreOverlap`) allineato
all'unique index: 409 se esiste già una voce con stesso nome (confronto
case-sensitive, identico al DB unique constraint) nella stessa org,
indipendentemente dalle RS.

## PDV misti (ereditati + manuali)
I PDV in CdG sono un mix di due fonti, entrambe referenziate dalle spese
via `pdvCodice`:
1. **Ereditati** (origine `"config"`, read-only): da
   `organization_config.puntiVendita`, `codice = codicePos || nome`.
   Gestione resta in `/admin`.
2. **Manuali** (origine `"manuale"`, CRUD locale al CdG): tabella
   `cdg_pdv_manuali` `(id, organizationId, ragioneSociale, codice, nome,
   indirizzo?, note?)` con unique index `UQ_cdg_pdv_manuali_org_rs_codice`
   su `(org, rs, codice)`. Creati e modificati da Anagrafiche → PDV.

Endpoint `GET /api/cdg/pdv-by-rs[?rs=...]` ritorna l'unione mergiata
`[{codice, nome, ragioneSociale, origine, id?, indirizzo?, note?}]`. Su
POST/PUT manuale: rifiuta 409 se il `(rs, codice)` collide con un PDV
ereditato; il manuale può però usare lo stesso codice cross-RS. Su rename
di codice o RS, le spese collegate vengono propagate automaticamente.
`validateSpesaFks` accetta `pdvCodice` se valido in **una** delle due
fonti per la RS della spesa.

## Modifica/cancellazione ereditati (write-through su org config)
Gli RS e PDV ereditati (origine `pdv` / `config`) sono editabili e
cancellabili direttamente dal CdG. Endpoint dedicati:
`PUT/DELETE /api/cdg/ragioni-sociali/inherited/:nome` e
`PUT/DELETE /api/cdg/pdv-inherited?rs=&codice=`. Lato server
`mutateOrgPuntiVendita` legge la config corrente, applica il mutator e
upsert preservando `configVersion`. Su rename RS: rinomina
`puntiVendita.ragioneSociale` in tutte le voci, propaga su
`cdg_categorie/fornitori.ragioniSociali` (array_replace),
`cdg_pdv_manuali`, `cdg_spese`, e RS manuale omonima. Su delete RS:
rimuove tutte le voci puntiVendita di quella RS + cascade come la delete
manuale. Su PDV ereditato: edit aggiorna `(codicePos|nome|ragioneSociale)`
preservando i campi extra (canale, cluster*, tipoPosizione) e propaga
rename a `cdg_spese`; delete rimuove la voce dalla config. PartitaIVA/Note
per RS ereditate vengono materializzate come override in
`cdg_ragioni_sociali`. UI: dialog Modifica con avviso "scrive su Gestione
Organizzazione"; AlertDialog di delete avvisa esplicitamente l'impatto
cross-app.

## API
`/api/cdg/{ragioni-sociali|ragioni-sociali/unified|categorie|fornitori|spese|pdv-manuali}`
CRUD + `GET /api/cdg/pdv-by-rs[?rs=...]` (mix config + manuali) +
`GET /api/cdg/spese/:id/allegato` (download). Tutte gated
`controllo_gestione` + admin/super_admin con scoping su `organizationId`.

## Tipo spesa, periodicità ricorrente e sfasamento cassa
Campi `ricorrente: boolean`, `periodicita: 'mensile'|'annuale'|null`,
`cashFlowOffsetMesi: int (0..3)`, `dataInizioRicorrenza: date|null`,
`dataFineRicorrenza: date|null` su `cdg_spese`. La UI obbliga a scegliere
fra "Una tantum" e "Ricorrente" (radio nel form). Se Ricorrente, va scelta
la periodicità (mensile o annuale) e una data inizio + data fine.
Lo sfasamento cassa (M / M+1 / M+2 / M+3) è disponibile sempre e definisce
la distanza in mesi tra `meseCompetenza` e `dataPagamento` di ogni
occorrenza generata. Backend: in POST il server calcola N occorrenze
iterando da dataInizio a dataFine con step 1 mese (mensile) o 12 mesi
(annuale); per ognuna `meseCompetenza` = mese iterato e `dataPagamento` =
(`meseCompetenza` + offset, giorno = giorno di dataInizio clampato al mese).
La master è la prima occorrenza, le successive sono cloni indipendenti
(no parent ref): edit/delete per riga singola. L'allegato NON viene
duplicato. UI tabella: badge `↻` su righe ricorrenti con tooltip
"Ricorrenza fino a DD/MM/YYYY".

## Allegati
Upload base64 in JSON → disk in `uploads/cdg/<orgId>/` (env override
`CDG_UPLOAD_DIR`), max 8MB, sanitized filename + path-traversal check sul
download. **Produzione**: settare
`CDG_UPLOAD_DIR=/var/www/incentive-w3/uploads/cdg` per persistenza tra deploy.

## Frontend
`client/src/pages/ControlloGestione.tsx`: 3 tab Dashboard (KPI totale + mese
corrente + categorie, PieChart per categoria, BarChart cassa vs competenza
per mese), Spese (tabella + dialog form con allegato e blocco IVA; il
selettore PDV usa `pdvCodice`), Anagrafiche (RS card unificata con badge
"da PDV"; tab Categorie/Fornitori via `MultiRsAnagraficaCrud` con
multiselect Checkbox per le RS associate e badge RS in tabella + filtro
"RS"; tab PDV via `PdvReadOnlyView` raggruppato per RS, read-only, con link
a `/admin`). Export Excel include colonne Imponibile / Aliquota IVA (%) /
IVA / Totale.
