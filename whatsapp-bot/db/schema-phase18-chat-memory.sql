-- Phase 18: Durable WhatsApp chat memory (history + meta + handoff) by phone key.
-- Fail-soft: in-memory session.js continues if table missing.

CREATE TABLE IF NOT EXISTS chat_memory (
  phone_key VARCHAR(64) PRIMARY KEY,
  thread_id TEXT,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  human_handoff JSONB,
  last_product_context JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_memory_updated_idx
  ON chat_memory (updated_at DESC);
