import { sql } from "drizzle-orm";
import type { CustomerJourneyItem } from "../shared/schema";
import { parseVenditaInfo } from "../shared/customerJourney";
import type { CjPhoneCommercialArticle, CjPhoneCommercialSale } from "../shared/customerJourneyPhoneCommercial";
import { db } from "./db";

/** Minimal, read-only BiSuite provenance for smartphone source receipts. */
export async function getCjPhoneCommercialSales(
  orgId: string,
  items: CustomerJourneyItem[],
  addettiFilter: string[] | null,
): Promise<CjPhoneCommercialSale[]> {
  const mine = addettiFilter?.map(value => value.trim().toLowerCase()).filter(Boolean);
  if (mine && mine.length === 0) return [];

  const saleIds = [...new Set(items
    .filter(item => item.organizationId === orgId
      && item.driver === "telefono"
      && (mine == null || mine.includes((item.addetto ?? "").trim().toLowerCase())))
    .map(item => item.bisuiteSaleId)
    .filter((id): id is string => !!id))];
  if (!saleIds.length) return [];

  const result = await db.execute(sql`
    SELECT s.id AS sale_id, s.data_vendita AS sale_date, s.nome_negozio AS pdv,
      a.ordinality AS ordinal,
      a.article->>'id' AS article_id,
      a.article->'categoria'->>'nome' AS category,
      a.article->>'descrizione' AS description,
      jsonb_build_object(
        'venditaInfo1', a.article->'dettaglio'->>'venditaInfo1',
        'venditaInfo2', a.article->'dettaglio'->>'venditaInfo2',
        'venditaInfo3', a.article->'dettaglio'->>'venditaInfo3',
        'venditaInfo4', a.article->'dettaglio'->>'venditaInfo4',
        'venditaInfo5', a.article->'dettaglio'->>'venditaInfo5'
      ) AS detail
    FROM bisuite_sales s
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.raw_data->'articoli')='array'
        THEN s.raw_data->'articoli' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS a(article, ordinality)
    WHERE s.organization_id=${orgId}
      AND s.id IN (${sql.join(saleIds.map(id => sql`${id}`), sql`, `)})
      AND ${mine == null ? sql`true` : sql`lower(trim(coalesce(s.raw_data->'addetto'->>'nominativo', s.nome_addetto, ''))) IN (${sql.join(mine.map(value => sql`${value}`), sql`, `)})`}
    ORDER BY s.data_vendita, s.id, a.ordinality
  `);

  const sales = new Map<string, CjPhoneCommercialSale>();
  for (const row of result.rows) {
    const saleId = String(row.sale_id);
    let sale = sales.get(saleId);
    if (!sale) {
      sale = {
        saleId,
        date: row.sale_date ? new Date(row.sale_date as string).toISOString() : null,
        pdv: row.pdv == null ? null : String(row.pdv),
        articles: [],
      };
      sales.set(saleId, sale);
    }
    const articleIdValue = row.article_id == null ? NaN : Number(row.article_id);
    const article: CjPhoneCommercialArticle = {
      articleId: Number.isSafeInteger(articleIdValue) ? articleIdValue : null,
      category: String(row.category ?? ""),
      description: String(row.description ?? ""),
      iccid: parseVenditaInfo(row.detail).iccid ?? null,
    };
    sale.articles.push(article);
  }
  return [...sales.values()];
}
