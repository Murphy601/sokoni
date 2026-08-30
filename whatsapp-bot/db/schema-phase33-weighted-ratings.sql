-- Phase 33: Rolling-window rating profiles (last 100) + event ledger

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS rating_score NUMERIC(4, 2) NOT NULL DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS rating_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_pool JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS completed_orders INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispute_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unresolved_disputes INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS badge_tier VARCHAR(32) NOT NULL DEFAULT 'newbie';

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS rating_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_pool JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS completed_deliveries INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS badge_tier VARCHAR(32) NOT NULL DEFAULT 'newbie';

-- Existing installs may have DEFAULT 0 from an earlier draft — normalize empty pools to grace 5.0
UPDATE users SET rating_score = 5.00
 WHERE rating_count = 0 AND (rating_pool IS NULL OR rating_pool = '[]'::jsonb)
   AND rating_score = 0;

CREATE TABLE IF NOT EXISTS rating_events (
  id              BIGSERIAL PRIMARY KEY,
  subject_type    VARCHAR(16) NOT NULL CHECK (subject_type IN ('seller', 'rider')),
  subject_id      INT NOT NULL,
  event_kind      VARCHAR(40) NOT NULL,
  stars           SMALLINT,
  delta           NUMERIC(5, 2),
  rating_before   NUMERIC(4, 2),
  rating_after    NUMERIC(4, 2) NOT NULL,
  review_count    INT NOT NULL DEFAULT 0,
  order_ref       VARCHAR(64),
  reason          TEXT,
  actor_label     VARCHAR(120),
  pool_entry_id   VARCHAR(64),
  purged_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rating_events ADD COLUMN IF NOT EXISTS pool_entry_id VARCHAR(64);
ALTER TABLE rating_events ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_rating_events_subject
  ON rating_events (subject_type, subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rating_events_order
  ON rating_events (order_ref)
  WHERE order_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_badge_tier ON users (badge_tier);
CREATE INDEX IF NOT EXISTS idx_riders_badge_tier ON riders (badge_tier);
