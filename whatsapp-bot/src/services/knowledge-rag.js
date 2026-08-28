/**
 * Optional pgvector / platform_knowledge retrieval.
 * Fail-soft: if extension/table missing, returns [] so markdown RAG continues.
 */
import { isDbEnabled, query } from "../db/pool.js";

/**
 * Keyword search over platform_knowledge (works without embeddings).
 * When embedding column is populated, prefer cosine later.
 */
export async function retrievePlatformKnowledge(queryText, { limit = 2, specialist = "general" } = {}) {
  if (!isDbEnabled()) return [];
  const tokens = String(queryText || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2)
    .slice(0, 8);
  if (!tokens.length) return [];

  const categoryPrefer =
    specialist === "seller"
      ? ["seller_policy", "shipping"]
      : specialist === "logistics"
        ? ["shipping", "buyer_policy"]
        : specialist === "dispute"
          ? ["buyer_policy", "seller_policy"]
          : null;

  try {
    // Rank by simple token hits in content (no embedding API required).
    const { rows } = await query(
      `SELECT id, category, content,
              (
                SELECT COUNT(*)::int FROM unnest($1::text[]) AS t(token)
                WHERE position(lower(t.token) in lower(content)) > 0
              ) AS score
         FROM platform_knowledge
        WHERE ($2::text[] IS NULL OR category = ANY($2::text[]))
        ORDER BY score DESC, id ASC
        LIMIT $3`,
      [tokens, categoryPrefer, Math.max(1, Math.min(5, limit))]
    );
    return (rows || [])
      .filter((r) => Number(r.score) > 0)
      .map((r) => ({
        id: `db:${r.category || "general"}:${r.id}`,
        excerpt: String(r.content || "").slice(0, 900),
        category: r.category || "general",
        score: Number(r.score) || 0,
      }));
  } catch (err) {
    // Table or extension may not exist yet
    if (!/platform_knowledge|does not exist/i.test(String(err.message || ""))) {
      console.warn("[knowledge-rag] retrieve skipped:", err.message);
    }
    return [];
  }
}

/**
 * Seed platform_knowledge from markdown chunks (idempotent upsert by source key).
 */
export async function upsertKnowledgeChunk({
  sourceKey,
  category = "general",
  content,
  embedding = null,
}) {
  if (!isDbEnabled() || !content) return { ok: false, reason: "unavailable" };
  try {
    await query(
      `INSERT INTO platform_knowledge (source_key, category, content, embedding, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (source_key) DO UPDATE SET
         category = EXCLUDED.category,
         content = EXCLUDED.content,
         embedding = COALESCE(EXCLUDED.embedding, platform_knowledge.embedding),
         updated_at = NOW()`,
      [sourceKey, category, content, embedding]
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
