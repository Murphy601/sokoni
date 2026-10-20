-- Phase 17: Product search embeddings (hybrid keyword + pgvector)
-- Fail-soft: keyword catalog search works without this table/extension.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS product_search_embeddings (
  product_ref VARCHAR(64) PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector(1536),
  price_kes INTEGER,
  in_stock BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_search_embeddings_stock_idx
  ON product_search_embeddings (in_stock)
  WHERE in_stock = TRUE;

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS product_search_embeddings_ivfflat
    ON product_search_embeddings USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'product_search_embeddings ivfflat skipped: %', SQLERRM;
END $$;
