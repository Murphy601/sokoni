/**
 * Product embeddings for hybrid catalog search (keyword + pgvector).
 * Fail-soft: missing DB/extension/API → empty vector hits; keyword search continues.
 */
import OpenAI from "openai";
import { isDbEnabled, query } from "../db/pool.js";
import { config } from "../config.js";

const EMBED_DIM = 1536;
const EMBED_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "openai/text-embedding-3-small";

function productSearchText(product = {}) {
  return [
    product.name,
    product.description,
    product.brand,
    product.secondaryBrand,
    product.category,
    product.subcategory,
    product.color,
    product.size,
    ...(Array.isArray(product.tags) ? product.tags : []),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

function embeddingClient() {
  if (!config.openai?.apiKey) return null;
  return new OpenAI({
    apiKey: config.openai.apiKey,
    baseURL: config.openai.baseUrl || "https://openrouter.ai/api/v1",
  });
}

/** Embed text → float[1536] or null. */
export async function embedText(text) {
  const client = embeddingClient();
  const input = String(text || "").trim();
  if (!client || !input) return null;
  try {
    const res = await client.embeddings.create({
      model: EMBED_MODEL,
      input: input.slice(0, 8000),
    });
    const vec = res?.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length < 8) return null;
    // Pad/truncate to schema dim if provider returns a different size
    if (vec.length === EMBED_DIM) return vec;
    if (vec.length > EMBED_DIM) return vec.slice(0, EMBED_DIM);
    return [...vec, ...Array(EMBED_DIM - vec.length).fill(0)];
  } catch (err) {
    console.warn("[product-embeddings] embed failed:", err.message);
    return null;
  }
}

function vectorLiteral(arr) {
  return `[${arr.map((n) => Number(n) || 0).join(",")}]`;
}

/** Upsert one product embedding (async-safe; never throws to callers). */
export async function upsertProductEmbedding(product) {
  if (!isDbEnabled() || !product?.id) return { ok: false, reason: "unavailable" };
  const content = productSearchText(product);
  if (!content) return { ok: false, reason: "empty" };
  const embedding = await embedText(content);
  if (!embedding) return { ok: false, reason: "embed_unavailable" };
  try {
    await query(
      `INSERT INTO product_search_embeddings
         (product_ref, content, embedding, price_kes, in_stock, updated_at)
       VALUES ($1, $2, $3::vector, $4, $5, NOW())
       ON CONFLICT (product_ref) DO UPDATE SET
         content = EXCLUDED.content,
         embedding = EXCLUDED.embedding,
         price_kes = EXCLUDED.price_kes,
         in_stock = EXCLUDED.in_stock,
         updated_at = NOW()`,
      [
        String(product.id),
        content,
        vectorLiteral(embedding),
        product.priceKes != null ? Number(product.priceKes) : null,
        product.inStock !== false,
      ]
    );
    return { ok: true };
  } catch (err) {
    if (!/product_search_embeddings|vector|does not exist/i.test(String(err.message || ""))) {
      console.warn("[product-embeddings] upsert skipped:", err.message);
    }
    return { ok: false, reason: err.message };
  }
}

/**
 * Cosine nearest-neighbor product refs.
 * @returns {Promise<Array<{ id: string, score: number }>>}
 */
export async function searchProductEmbeddingHits(
  queryText,
  { limit = 8, maxPriceKes = null, minPriceKes = null } = {}
) {
  if (!isDbEnabled()) return [];
  const q = String(queryText || "").trim();
  if (!q) return [];
  const embedding = await embedText(q);
  if (!embedding) return [];
  try {
    const { rows } = await query(
      `SELECT product_ref,
              1 - (embedding <=> $1::vector) AS score
         FROM product_search_embeddings
        WHERE in_stock = TRUE
          AND embedding IS NOT NULL
          AND ($2::int IS NULL OR price_kes IS NULL OR price_kes <= $2)
          AND ($3::int IS NULL OR price_kes IS NULL OR price_kes >= $3)
        ORDER BY embedding <=> $1::vector
        LIMIT $4`,
      [
        vectorLiteral(embedding),
        maxPriceKes != null ? Number(maxPriceKes) : null,
        minPriceKes != null ? Number(minPriceKes) : null,
        Math.max(1, Math.min(30, Number(limit) || 8)),
      ]
    );
    return (rows || []).map((r) => ({
      id: String(r.product_ref),
      score: Number(r.score) || 0,
    }));
  } catch (err) {
    if (!/product_search_embeddings|vector|does not exist/i.test(String(err.message || ""))) {
      console.warn("[product-embeddings] search skipped:", err.message);
    }
    return [];
  }
}

/** Fire-and-forget embed after publish / catalog sync. */
export function scheduleProductEmbedding(product) {
  if (!product?.id) return;
  setImmediate(() => {
    void upsertProductEmbedding(product).catch(() => {});
  });
}
