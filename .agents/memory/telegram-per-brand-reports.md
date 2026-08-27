---
name: Report Telegram separati per brand
description: Invarianti del percorso report per-brand (filtri, dedup, punti di leak)
---

- Brand dei PDV: `brandIds[]` in organization_config.config.puntiVendita è la sorgente canonica; le vendite BiSuite NON hanno brand affidabile, si filtra per codicePos PRIMA di ogni aggregato (giorno, mese, trend, storico, DTS).
- **Perché fail-closed sul DTS:** i lead DTS sono org-level; in un report brand vanno tenuti SOLO i lead con idVendita agganciato a una vendita del brand (via dtsSaleCodiceEsterno), altrimenti volumi/conversioni cross-brand trapelano nell'allegato.
- Tre punti dove i brandIds si perdono/contaminano se non gestiti: (1) hydrate del form PDV lato client deve copiare brandIds o un normale edit li azzera col PUT; (2) il PUT generico /api/organization-config riscrive puntiVendita e deve normalizzare/validare i brandIds come gli endpoint struttura; (3) config contenuti per-brand in gara_config `telegramReportContent.perBrand[brandId]` con fallback al blocco root legacy.
- Dedup/recovery: telegram_report_sends.brand_key ('' = report unico legacy), unique org+data+slot+brand; recovery reinvia solo i brand mancanti; sync BiSuite una sola volta per org (primo brand non deduplicato); errore di un brand non blocca gli altri e si registra solo l'invio riuscito.
- Gating contenuti: solo brand riconosciuto WindTre (telegramBrandKindOf tollerante) può mostrare Protetti/Verisure; gli altri sono fail-closed.
- L'allegato HTML non mostra i nomi consulenti DTS: i test sul leak DTS devono asserire sui contatori ("DTS fissati") non sui nomi.
