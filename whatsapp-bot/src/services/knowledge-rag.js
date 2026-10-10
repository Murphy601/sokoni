/**
 * Optional pgvector / platform_knowledge retrieval.
 * Fail-soft: if extension/table missing, returns [] so markdown RAG continues.
 *
 * Cosine search uses the existing 1536-dim column (same as product embeddings).
 * Do not add a second store_policies table — phase44 exposes a VIEW over this one.
 */
import { isDbEnabled, query } from "../db/pool.js";

export const POLICY_SIMILARITY_MIN = Number(process.env.POLICY_SIMILARITY_MIN || 0.7) || 0.7;

function vectorLiteral(arr) {
  return `[${arr.map((n) => Number(n) || 0).join(",")}]`;
}

function specialistCategories(specialist) {
  if (specialist === "seller") return ["seller_policy", "shipping"];
  if (specialist === "logistics") return ["shipping", "buyer_policy"];
  if (specialist === "dispute") return ["buyer_policy", "seller_policy"];
  return null;
}

function mapPolicyRow(row, score) {
  const answer = String(row.answer || row.content || "");
  const question = String(row.question || "").trim() || answer.slice(0, 160);
  return {
    id: `db:${row.category || "general"}:${row.id}`,
    question,
    answer,
    excerpt: answer.slice(0, 900),
    category: row.category || "general",
    score: Number(score) || 0,
    similarity: Number(score) || 0,
  };
}

/**
 * Named tool used by the ops agent and shopper RAG.
 * Embeds the question, then cosine-ranks platform_knowledge (store_policies view).
 */
export async function searchStorePolicies(queryText, { limit = 3, minSimilarity = POLICY_SIMILARITY_MIN } = {}) {
  const q = String(queryText || "").trim();
  if (!q) {
    return { ok: false, error: "missing_query", tool: "search_store_policies", hits: [] };
  }
  if (!isDbEnabled()) {
    return { ok: false, error: "database_offline", tool: "search_store_policies", hits: [] };
  }

  let embedding = null;
  try {
    const { embedText } = await import("./product-embeddings.js");
    embedding = await embedText(q);
  } catch (err) {
    return {
      ok: false,
      error: "embed_failed",
      tool: "search_store_policies",
      hits: [],
      message: String(err?.message || err).slice(0, 160),
    };
  }
  if (!embedding) {
    return { ok: false, error: "embed_unavailable", tool: "search_store_policies", hits: [] };
  }

  const floor = Math.min(0.99, Math.max(0.3, Number(minSimilarity) || POLICY_SIMILARITY_MIN));
  const lim = Math.max(1, Math.min(5, Number(limit) || 3));
  const lit = vectorLiteral(embedding);

  try {
    const { rows } = await query(
      `SELECT id, category,
              COALESCE(NULLIF(question, ''), left(content, 160)) AS question,
              content AS answer,
              1 - (embedding <=> $1::vector) AS similarity
         FROM platform_knowledge
        WHERE embedding IS NOT NULL
          AND 1 - (embedding <=> $1::vector) > $2
        ORDER BY embedding <=> $1::vector
        LIMIT $3`,
      [lit, floor, lim]
    );
    const hits = (rows || []).map((r) => mapPolicyRow(r, r.similarity));
    return {
      ok: true,
      tool: "search_store_policies",
      source: "pgvector",
      hits,
      count: hits.length,
    };
  } catch (err) {
    return {
      ok: false,
      error: "search_failed",
      tool: "search_store_policies",
      hits: [],
      message: String(err?.message || err).slice(0, 160),
    };
  }
}

/**
 * Keyword search over platform_knowledge (works without embeddings).
 */
export async function retrievePlatformKnowledge(queryText, { limit = 2, specialist = "general" } = {}) {
  if (!isDbEnabled()) return [];
  const tokens = String(queryText || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2)
    .slice(0, 8);
  if (!tokens.length) return [];

  const categoryPrefer = specialistCategories(specialist);

  try {
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
      .map((r) => mapPolicyRow(r, r.score));
  } catch (err) {
    if (!/platform_knowledge|does not exist|question/i.test(String(err.message || ""))) {
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
  question = null,
  embedding = null,
}) {
  if (!isDbEnabled() || !content) return { ok: false, reason: "unavailable" };
  const vec = Array.isArray(embedding) ? vectorLiteral(embedding) : embedding;
  const hasVec = Boolean(vec);
  try {
    await query(
      hasVec
        ? `INSERT INTO platform_knowledge (source_key, category, content, question, embedding, updated_at)
           VALUES ($1, $2, $3, $4, $5::vector, NOW())
           ON CONFLICT (source_key) DO UPDATE SET
             category = EXCLUDED.category,
             content = EXCLUDED.content,
             question = COALESCE(EXCLUDED.question, platform_knowledge.question),
             embedding = COALESCE(EXCLUDED.embedding, platform_knowledge.embedding),
             updated_at = NOW()`
        : `INSERT INTO platform_knowledge (source_key, category, content, question, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (source_key) DO UPDATE SET
             category = EXCLUDED.category,
             content = EXCLUDED.content,
             question = COALESCE(EXCLUDED.question, platform_knowledge.question),
             updated_at = NOW()`,
      hasVec ? [sourceKey, category, content, question, vec] : [sourceKey, category, content, question]
    );
    return { ok: true };
  } catch (err) {
    if (/question/i.test(String(err.message || ""))) {
      try {
        await query(
          hasVec
            ? `INSERT INTO platform_knowledge (source_key, category, content, embedding, updated_at)
               VALUES ($1, $2, $3, $4::vector, NOW())
               ON CONFLICT (source_key) DO UPDATE SET
                 category = EXCLUDED.category,
                 content = EXCLUDED.content,
                 embedding = COALESCE(EXCLUDED.embedding, platform_knowledge.embedding),
                 updated_at = NOW()`
            : `INSERT INTO platform_knowledge (source_key, category, content, updated_at)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (source_key) DO UPDATE SET
                 category = EXCLUDED.category,
                 content = EXCLUDED.content,
                 updated_at = NOW()`,
          hasVec ? [sourceKey, category, content, vec] : [sourceKey, category, content]
        );
        return { ok: true, questionSkipped: true };
      } catch (err2) {
        return { ok: false, reason: err2.message };
      }
    }
    return { ok: false, reason: err.message };
  }
}

/** Embed + upsert one FAQ row. Fail-soft when the embed API is down. */
export async function upsertPolicyWithEmbedding({ sourceKey, category, question, answer }) {
  const content = String(answer || "").trim();
  if (!content) return { ok: false, reason: "empty" };
  let embedding = null;
  try {
    const { embedText } = await import("./product-embeddings.js");
    embedding = await embedText(`${question || ""}\n${content}`.trim());
  } catch {
    embedding = null;
  }
  return upsertKnowledgeChunk({
    sourceKey,
    category,
    content,
    question: question || null,
    embedding,
  });
}
