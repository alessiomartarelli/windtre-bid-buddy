import React from "react";
import { normalizeCjIccid } from "../../../../shared/customerJourney";
import type { CjCbSimReference } from "../../../../shared/customerJourneyCbSimReferences";

export function SimIccid({ iccid, testId }: { iccid?: string | null; testId: string }) {
  return <p className="text-[11px] text-muted-foreground mt-1" data-testid={testId}>
    ICCID SIM abbinata: <span className="font-mono break-all">{normalizeCjIccid(iccid) ?? "Non disponibile o non verificabile"}</span>
  </p>;
}

export function CbSimReferences({ references }: { references: CjCbSimReference[] }) {
  if (!references.length) return null;
  return <section className="rounded-md border p-4 space-y-3" data-testid="cj-cb-sim-references">
    <h3 className="text-sm font-semibold">CB — SIM associate</h3>
    <p className="text-xs text-muted-foreground">Riferimenti delle vendite collegate ai contratti visibili. Non aggiungono piste o gettoni CJ.</p>
    {references.map(r => <div key={r.id} className="text-xs">
      <p className="font-medium">{r.categoria} · {r.descrizione}</p>
      <SimIccid iccid={r.iccid} testId={`cb-sim-iccid-${r.id}`} />
      <p className="text-muted-foreground">{r.data ? new Date(r.data).toLocaleDateString("it-IT", { timeZone: "UTC" }) : "Data non disponibile"}{r.pdv ? ` · ${r.pdv}` : ""}</p>
    </div>)}
  </section>;
}
