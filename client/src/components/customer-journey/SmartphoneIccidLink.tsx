import React from "react";
import type { CjPhoneIccidLink } from "../../../../shared/customerJourneyPhoneLink";

export function SmartphoneIccidLink({ link, itemId }: { link: CjPhoneIccidLink; itemId: string }) {
  const label = link.status === "abbinata" ? "SIM abbinata"
    : link.status === "corrispondenza" ? "SIM con ICCID corrispondente — non abbinamento CJ valido"
    : "SIM candidate — abbinamento ambiguo";
  return (
    <div className="mt-1 space-y-1 text-[11px] text-muted-foreground break-words" data-testid={`phone-iccid-link-${itemId}`}>
      <p>ICCID smartphone: <span className="font-mono break-all">{link.phoneIccid ?? "Mancante o non valido"}</span></p>
      {link.mobiles.map(m => (
        <div key={m.itemId}>
          <p>{label}: <span className="font-mono break-all">{m.iccid?.trim().replace(/[\s-]/g, "")}</span></p>
          <p>{m.descrizione || m.tipologia || "Mobile"}{m.insertedAt ? ` · ${new Date(m.insertedAt).toLocaleDateString("it-IT", { timeZone: "UTC" })}` : ""}{m.pdv ? ` · ${m.pdv}` : ""}</p>
        </div>
      ))}
      {link.status === "non_verificabile" && <p>Nessuna SIM con ICCID corrispondente nei contratti visibili: abbinamento non verificabile.</p>}
    </div>
  );
}
