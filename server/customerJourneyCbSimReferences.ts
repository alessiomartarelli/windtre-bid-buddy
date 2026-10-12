import { sql } from "drizzle-orm";
import { db } from "./db";
import type { CustomerJourneyItem } from "../shared/schema";
import { cjCbSimReference, CJ_CB_REFERENCE_CATEGORIES, type CjCbSimReference } from "../shared/customerJourneyCbSimReferences";

/** CB are read-only commercial references, never new CJ drivers or paid tracks. */
export async function getCjCbSimReferences(
  orgId: string, items: CustomerJourneyItem[], addettiFilter: string[] | null,
): Promise<CjCbSimReference[]> {
  const mine = addettiFilter?.map(a => a.trim().toLowerCase()).filter(Boolean);
  if (mine && mine.length === 0) return [];
  const saleIds = [...new Set(items.filter(it => it.organizationId === orgId
    && (mine == null || mine.includes((it.addetto ?? "").trim().toLowerCase())))
    .map(it => it.bisuiteSaleId).filter((id): id is string => !!id))];
  if (!saleIds.length) return [];
  const result = await db.execute(sql`
    SELECT s.id AS sale, a.ordinality AS ordinal,
      s.data_vendita AS data, s.nome_negozio AS pdv,
      a.article->'categoria'->>'nome' AS categoria,
      a.article->>'descrizione' AS descrizione,
      jsonb_build_object(
        'venditaInfo1', a.article->'dettaglio'->>'venditaInfo1',
        'venditaInfo2', a.article->'dettaglio'->>'venditaInfo2',
        'venditaInfo3', a.article->'dettaglio'->>'venditaInfo3',
        'venditaInfo4', a.article->'dettaglio'->>'venditaInfo4',
        'venditaInfo5', a.article->'dettaglio'->>'venditaInfo5'
      ) AS dettaglio
    FROM bisuite_sales s
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.raw_data->'articoli')='array'
        THEN s.raw_data->'articoli' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS a(article, ordinality)
    WHERE s.organization_id=${orgId}
      AND s.id IN (${sql.join(saleIds.map(id => sql`${id}`), sql`, `)})
      AND ${mine == null ? sql`true` : sql`lower(trim(coalesce(s.nome_addetto,''))) IN (${sql.join(mine.map(a => sql`${a}`), sql`, `)})`}
      AND upper(trim(a.article->'categoria'->>'nome')) IN
        (${sql.join(CJ_CB_REFERENCE_CATEGORIES.map(c => sql`${c}`), sql`, `)})
    ORDER BY s.data_vendita, s.id, a.ordinality
  `);
  return result.rows.flatMap(row => {
    const reference = cjCbSimReference(
      `${row.sale}:${row.ordinal}`,
      { categoria: row.categoria as string, descrizione: row.descrizione as string, dettaglio: row.dettaglio },
      row.data ? new Date(row.data as string).toISOString() : null, row.pdv as string | null,
    );
    return reference ? [reference] : [];
  });
}
