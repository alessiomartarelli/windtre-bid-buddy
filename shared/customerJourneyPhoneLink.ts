import {
  cjPhoneEligibility, cjPhoneKey, cjT0Month, normalizeCjIccid,
  type CjReportRow,
} from "./customerJourney";
import {
  cjPhoneCommercialEvidence,
  type CjPhoneCommercialEvidence,
  type CjPhoneCommercialSale,
} from "./customerJourneyPhoneCommercial";

export interface CjPhoneIccidLink {
  phoneIccid: string | null;
  status: "abbinata" | "corrispondenza" | "ambigua" | "non_verificabile";
  mobiles: CjReportRow[];
  cjRole: "iniziale" | "extra" | "escluso";
  commercial: CjPhoneCommercialEvidence;
  phoneDescription: string;
  phoneDate: string | null;
  phonePdv: string;
}

/** Display-only links within the caller's authorized items. Never changes eligibility. */
export function cjPhoneIccidLinks(
  rows: CjReportRow[], openedAt: string | null, triggerBisuiteId?: number | null,
  commercialSales: CjPhoneCommercialSale[] = [],
): Map<string, CjPhoneIccidLink> {
  const eligibility = cjPhoneEligibility(rows, cjT0Month(openedAt, rows), openedAt, triggerBisuiteId);
  const links = new Map<string, CjPhoneIccidLink>();
  for (const phone of rows.filter(r => r.driver === "telefono")) {
    const phoneIccid = normalizeCjIccid(phone.iccid);
    const result = eligibility.get(cjPhoneKey(phone));
    const valid = result?.kind === "iniziale" || result?.kind === "extra";
    const candidates = phoneIccid
      ? rows.filter(r => r.driver === "mobile" && normalizeCjIccid(r.iccid) === phoneIccid)
      : [];
    const distinct = new Map<string, CjReportRow>();
    for (const mobile of candidates) {
      const key = `${mobile.bisuiteSaleId ?? ""}:${mobile.codiceContratto || mobile.bisuiteArticleId || cjPhoneKey(mobile)}`;
      if (!distinct.has(key)) distinct.set(key, mobile);
    }
    const matched = valid && result.mobile
      ? candidates.find(r => cjPhoneKey(r) === cjPhoneKey(result.mobile!))
      : undefined;
    links.set(cjPhoneKey(phone), {
      phoneIccid,
      status: matched ? "abbinata" : distinct.size > 1 ? "ambigua" : distinct.size === 1 ? "corrispondenza" : "non_verificabile",
      mobiles: matched ? [matched] : [...distinct.values()],
      cjRole: result?.kind === "iniziale" ? "iniziale" : result?.kind === "extra" ? "extra" : "escluso",
      commercial: cjPhoneCommercialEvidence(phoneIccid, phone.bisuiteSaleId ?? null, commercialSales),
      phoneDescription: phone.descrizione || phone.tipologia || phone.categoria || "Smartphone",
      phoneDate: phone.eventDate ?? phone.insertedAt ?? commercialSales.find(s => s.saleId === phone.bisuiteSaleId)?.date ?? null,
      phonePdv: phone.pdv || commercialSales.find(s => s.saleId === phone.bisuiteSaleId)?.pdv || "",
    });
  }
  return links;
}
