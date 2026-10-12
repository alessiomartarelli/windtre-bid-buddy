import { classifyCategory } from "./bisuiteClassification";

export interface CjPhoneCommercialArticle {
  articleId: number | null;
  category: string;
  description: string;
  iccid: string | null;
}

export interface CjPhoneCommercialSale {
  saleId: string;
  date: string | null;
  pdv: string | null;
  articles: CjPhoneCommercialArticle[];
}

export type CjPhoneCommercialChannel = "mobile_ga" | "cb" | "ambigua" | "non_verificabile";

export interface CjPhoneCommercialEvidence {
  channel: CjPhoneCommercialChannel;
  channelCategories: string[];
  cbArticle: CjPhoneCommercialArticle | null;
  cbArticleStatus: "identificato" | "ambiguo" | "non_verificabile";
  sale: CjPhoneCommercialSale | null;
}

/**
 * Commercial provenance only. A channel is inferred from classified article
 * categories in the smartphone's own BiSuite sale; a contract link still
 * requires an exact ICCID match and never changes CJ eligibility.
 */
export function cjPhoneCommercialEvidence(
  phoneIccid: string | null,
  saleId: string | null,
  sales: CjPhoneCommercialSale[],
): CjPhoneCommercialEvidence {
  const sale = saleId ? sales.find(candidate => candidate.saleId === saleId) ?? null : null;
  if (!sale) {
    return { channel: "non_verificabile", channelCategories: [], cbArticle: null, cbArticleStatus: "non_verificabile", sale: null };
  }

  const mobileCategories = new Set<string>();
  const cbCategories = new Set<string>();
  for (const article of sale.articles) {
    const classification = classifyCategory(article.category);
    if (classification?.pista === "mobile") mobileCategories.add(article.category);
    if (classification?.pista === "cb") cbCategories.add(article.category);
  }
  const channels = Number(mobileCategories.size > 0) + Number(cbCategories.size > 0);
  const channel: CjPhoneCommercialChannel = channels > 1
    ? "ambigua"
    : mobileCategories.size > 0 ? "mobile_ga"
    : cbCategories.size > 0 ? "cb"
    : "non_verificabile";

  const cbMatches = phoneIccid
    ? sale.articles.filter(article =>
      classifyCategory(article.category)?.pista === "cb" && article.iccid === phoneIccid)
    : [];
  return {
    channel,
    channelCategories: [...mobileCategories, ...cbCategories],
    cbArticle: cbMatches.length === 1 ? cbMatches[0] : null,
    cbArticleStatus: cbMatches.length > 1 ? "ambiguo"
      : cbMatches.length === 1 ? "identificato" : "non_verificabile",
    sale,
  };
}
