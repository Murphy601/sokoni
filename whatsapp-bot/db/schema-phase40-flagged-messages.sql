-- Phase 40: audit row for a chat message the screener refused.
--
-- The message itself is never inserted. This table is the only copy, so an
-- admin can review it later. Threads are a pair of user ids on messages, so
-- the flag stores those two ids rather than a conversation row.
--
-- Bundles and scratch cards already live in phase 38 and phase 37. This
-- migration does not recreate them.

CREATE TABLE IF NOT EXISTS flagged_messages (
  id                BIGSERIAL PRIMARY KEY,
  sender_user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  receiver_user_id  INT REFERENCES users(id) ON DELETE SET NULL,
  content           TEXT NOT NULL,
  violation_type    VARCHAR(32) NOT NULL,
  status            VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  admin_notes       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  CONSTRAINT flagged_messages_status_check CHECK (
    status IN ('PENDING', 'WARNED', 'DISMISSED')
  ),
  CONSTRAINT flagged_messages_violation_check CHECK (
    violation_type IN (
      'PHONE_NUMBER',
      'OFF_PLATFORM_PAYMENT',
      'EXTERNAL_LINK',
      'CONTACT_DETAILS'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_flagged_messages_status
  ON flagged_messages (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_flagged_messages_sender
  ON flagged_messages (sender_user_id, created_at DESC);

INSERT INTO schema_migrations (name)
VALUES ('phase40_flagged_messages')
ON CONFLICT (name) DO NOTHING;
