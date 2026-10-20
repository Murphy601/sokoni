-- Phase 44: waitlist + reorder reminders + policy Q/A on existing pgvector table.
-- Does NOT create a second store_policies table — platform_knowledge already holds FAQ/policy text.
-- Vector pieces fail-soft when CREATE EXTENSION vector is missing.

CREATE TABLE IF NOT EXISTS product_waitlist (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ,
  UNIQUE (phone, product_id)
);

CREATE INDEX IF NOT EXISTS product_waitlist_open_idx
  ON product_waitlist (product_id)
  WHERE notified_at IS NULL;

CREATE TABLE IF NOT EXISTS reorder_reminders (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  phone VARCHAR(20) NOT NULL,
  product_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snooze_until TIMESTAMPTZ,
  UNIQUE (order_id, phone)
);

DO $$
BEGIN
  ALTER TABLE platform_knowledge ADD COLUMN IF NOT EXISTS question TEXT;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'platform_knowledge missing — skip question column';
  WHEN OTHERS THEN
    RAISE NOTICE 'platform_knowledge question column skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS platform_knowledge_embedding_hnsw
    ON platform_knowledge USING hnsw (embedding vector_cosine_ops);
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'platform_knowledge hnsw skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  EXECUTE $view$
    CREATE OR REPLACE VIEW store_policies AS
    SELECT
      id,
      category,
      COALESCE(NULLIF(question, ''), left(content, 160)) AS question,
      content AS answer,
      embedding
    FROM platform_knowledge
  $view$;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'store_policies view skipped — platform_knowledge missing';
  WHEN OTHERS THEN
    RAISE NOTICE 'store_policies view skipped: %', SQLERRM;
END $$;

INSERT INTO schema_migrations (name)
VALUES ('phase44_native_jobs')
ON CONFLICT (name) DO NOTHING;
