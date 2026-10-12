import React from "react";
import type { CjPhoneIccidLink } from "../../../../shared/customerJourneyPhoneLink";

export function SmartphoneIccidLink({ link, itemId }: { link: CjPhoneIccidLink; itemId: string }) {
  const label = link.status === "abbinata" ? "SIM abbinata"
    : link.status === "corrispondenza" ? "SIM con ICCID corrispondente — non abbinamento CJ valido"
    : link.status === "ambigua" ? "SIM candidate — abbinamento ambiguo"
    : "SIM non verificabile";
  const channelLabel = link.commercial.channel === "mobile_ga" ? "MOBILE/GA"
    : link.commercial.channel === "cb" ? "CB"
    : link.commercial.channel === "ambigua" ? "MOBILE/GA e CB rilevati — canale ambiguo"
    : "Non verificabile";
  const roleLabel = link.cjRole === "iniziale" ? "Smartphone iniziale — concorre alle piste base"
    : link.cjRole === "extra" ? "Coppia extra — gettone aggiuntivo di 20 €, separato dal base"
    : "Escluso dal gettone CJ";
  return (
    <div className="mt-2 rounded-md border bg-muted/20 p-2.5 space-y-2 text-[11px] text-muted-foreground break-words" data-testid={`phone-iccid-link-${itemId}`}>
      <p><span className="font-medium text-foreground">Canale commerciale:</span> {channelLabel}
        {link.commercial.channelCategories.length > 0 && ` (${link.commercial.channelCategories.join(", ")})`}
      </p>
      <p><span className="font-medium text-foreground">Ruolo CJ:</span> {roleLabel}</p>
      <p>{link.phoneDescription}
        {link.phoneDate ? ` · ${new Date(link.phoneDate).toLocaleDateString("it-IT", { timeZone: "UTC" })}` : " · Data non disponibile"}
        {link.phonePdv ? ` · ${link.phonePdv}` : " · PDV non disponibile"}
      </p>
      <p>ICCID smartphone: <span className="font-mono break-all">{link.phoneIccid ?? "Mancante o non valido"}</span></p>
      {link.mobiles.map(m => (
        <div key={m.itemId}>
          <p>{label}: <span className="font-mono break-all">{m.iccid?.trim().replace(/[\s-]/g, "")}</span></p>
          <p>{m.descrizione || m.tipologia || "Mobile"}
            {m.codiceContratto ? ` · Contratto ${m.codiceContratto}` : ""}
            {m.bisuiteArticleId != null ? ` · Articolo BiSuite ${m.bisuiteArticleId}` : ""}
            {m.insertedAt ? ` · ${new Date(m.insertedAt).toLocaleDateString("it-IT", { timeZone: "UTC" })}` : ""}
            {m.pdv ? ` · ${m.pdv}` : ""}
          </p>
          {m.itemId && <a className="underline text-primary" href={`#row-item-${m.itemId}`}>Vai alla riga SIM</a>}
        </div>
      ))}
      {link.commercial.cbArticleStatus === "identificato" && link.commercial.cbArticle ? (
          <div data-testid={`phone-cb-article-${itemId}`}>
            <p><span className="font-medium text-foreground">Riferimento CB verificato per ICCID:</span> {link.commercial.cbArticle.category} · {link.commercial.cbArticle.description}</p>
            <p>Vendita {link.commercial.sale?.date ? new Date(link.commercial.sale.date).toLocaleDateString("it-IT", { timeZone: "UTC" }) : "data non disponibile"}
              {link.commercial.sale?.pdv ? ` · ${link.commercial.sale.pdv}` : ""}
              {link.commercial.cbArticle.articleId != null ? ` · Articolo ${link.commercial.cbArticle.articleId}` : ""}
            </p>
            <p className="font-mono break-all">ICCID CB: {link.commercial.cbArticle.iccid}</p>
          </div>
      ) : link.commercial.channel === "cb" ? (
          <p>Canale CB rilevato nella vendita, ma nessun articolo/contratto CB è attribuibile a questo smartphone con certezza{link.commercial.cbArticleStatus === "ambiguo" ? " (più riferimenti con lo stesso ICCID)" : ""}.</p>
      ) : null}
      {link.status === "non_verificabile" && <p>Nessuna SIM con ICCID corrispondente nei contratti visibili: abbinamento non verificabile.</p>}
      {link.commercial.channel === "cb" && link.cjRole === "escluso" && link.status === "corrispondenza" && (
        <p>La SIM richiamata è riconosciuta per ICCID, ma questa vendita CB successiva non costituisce una nuova coppia SIM–smartphone valida per il gettone CJ.</p>
      )}
      {link.commercial.channel === "cb" && link.cjRole === "escluso" && link.status === "non_verificabile" && (
        <p>La dicitura CB identifica il canale commerciale, non dimostra una coppia CJ: serve una SIM ammissibile con ICCID corrispondente.</p>
      )}
    </div>
  );
}
