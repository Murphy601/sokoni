-- Phase 16: Knowledge base for Sokoni Plug RAG
-- Keyword RAG over knowledge/*.md works without this.
-- Apply when Postgres supports CREATE EXTENSION vector (optional for embeddings).

CREATE EXTENSION IF NOT EXISTS vector;

-- Canonical policy store (matches ops blueprint: category + content + optional embedding)
CREATE TABLE IF NOT EXISTS platform_knowledge (
  id SERIAL PRIMARY KEY,
  source_key TEXT UNIQUE,
  category VARCHAR(50) NOT NULL DEFAULT 'general', -- buyer_policy | seller_policy | shipping | general
  content TEXT NOT NULL,
  embedding vector(1536),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS platform_knowledge_category_idx
  ON platform_knowledge (category);

-- Optional ivfflat — only useful once embeddings are populated
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS platform_knowledge_embedding_ivfflat
    ON platform_knowledge USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'platform_knowledge ivfflat skipped: %', SQLERRM;
END $$;

-- Legacy / alternate embeddings table (kept for compatibility)
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  chunk_index INT NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  embedding vector(1536),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS knowledge_embeddings_ivfflat
    ON knowledge_embeddings USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'knowledge_embeddings ivfflat skipped: %', SQLERRM;
END $$;
