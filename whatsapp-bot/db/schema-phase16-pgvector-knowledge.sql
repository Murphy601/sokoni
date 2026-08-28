-- Optional pgvector knowledge embeddings (Phase 7.2+)
-- Run only when the Postgres instance supports CREATE EXTENSION vector.
-- Until then, Sokoni Plug uses chunked keyword RAG over whatsapp-bot/knowledge/*.md

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  chunk_index INT NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  embedding vector(1536),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_embeddings_ivfflat
  ON knowledge_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
