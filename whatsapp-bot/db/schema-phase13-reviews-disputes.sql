-- Phase 13 — bidirectional reviews + dispute resolution center
-- Additive: keeps existing buyer→seller reviews; adds seller→buyer + disputes.

-- ---------------------------------------------------------------------------
-- Reviews: direction (buyer_to_seller | seller_to_buyer)
-- ---------------------------------------------------------------------------

ALTER TABLE order_reviews
  ADD COLUMN IF NOT EXISTS direction VARCHAR(20) NOT NULL DEFAULT 'buyer_to_seller';

DO $$ BEGIN
  ALTER TABLE order_reviews
    ADD CONSTRAINT order_reviews_direction_check
    CHECK (direction IN ('buyer_to_seller', 'seller_to_buyer'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Drop single-order uniqueness so both directions can exist per order.
ALTER TABLE order_reviews DROP CONSTRAINT IF EXISTS order_reviews_order_id_key;
DROP INDEX IF EXISTS idx_order_reviews_order_ref_unique;

-- Direction-aware uniqueness (skip if legacy duplicates block creation).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_order_reviews_ref_direction') THEN
    IF EXISTS (
      SELECT 1 FROM order_reviews
      WHERE order_ref IS NOT NULL AND BTRIM(order_ref) <> ''
      GROUP BY UPPER(order_ref), direction
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'phase13: skipping idx_order_reviews_ref_direction (duplicate UPPER(order_ref)+direction)';
    ELSE
      CREATE UNIQUE INDEX idx_order_reviews_ref_direction
        ON order_reviews (UPPER(order_ref), direction)
        WHERE order_ref IS NOT NULL AND BTRIM(order_ref) <> '';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_order_reviews_order_id_direction') THEN
    IF EXISTS (
      SELECT 1 FROM order_reviews
      WHERE order_id IS NOT NULL
      GROUP BY order_id, direction
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'phase13: skipping idx_order_reviews_order_id_direction (duplicate order_id+direction)';
    ELSE
      CREATE UNIQUE INDEX idx_order_reviews_order_id_direction
        ON order_reviews (order_id, direction)
        WHERE order_id IS NOT NULL;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_order_reviews_buyer_subject
  ON order_reviews (buyer_user_id, created_at DESC)
  WHERE direction = 'seller_to_buyer';

CREATE INDEX IF NOT EXISTS idx_order_reviews_seller_subject
  ON order_reviews (seller_user_id, created_at DESC)
  WHERE direction = 'buyer_to_seller';

-- ---------------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE dispute_status AS ENUM (
    'open',
    'under_review',
    'resolved_refund',
    'resolved_release',
    'closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE dispute_reason AS ENUM (
    'not_as_described',
    'wrong_item',
    'damaged',
    'not_received',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS order_disputes (
  id                    BIGSERIAL PRIMARY KEY,
  order_ref             VARCHAR(64) NOT NULL,
  order_id              INT REFERENCES orders(id) ON DELETE SET NULL,
  buyer_user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason                dispute_reason NOT NULL DEFAULT 'other',
  status                dispute_status NOT NULL DEFAULT 'open',
  buyer_statement       TEXT,
  seller_response       TEXT,
  admin_notes           TEXT,
  resolution            VARCHAR(20),
  escrow_frozen_at      TIMESTAMPTZ,
  resolved_at           TIMESTAMPTZ,
  resolved_by           VARCHAR(120),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_disputes_open_ref
  ON order_disputes (UPPER(order_ref))
  WHERE status IN ('open', 'under_review');

CREATE INDEX IF NOT EXISTS idx_order_disputes_buyer
  ON order_disputes (buyer_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_disputes_seller
  ON order_disputes (seller_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_disputes_status
  ON order_disputes (status, created_at DESC);

CREATE TABLE IF NOT EXISTS dispute_evidence (
  id                    BIGSERIAL PRIMARY KEY,
  dispute_id            BIGINT NOT NULL REFERENCES order_disputes(id) ON DELETE CASCADE,
  uploaded_by_user_id   INT REFERENCES users(id) ON DELETE SET NULL,
  kind                  VARCHAR(24) NOT NULL DEFAULT 'other',
  url                   TEXT,
  note                  TEXT,
  meta                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_dispute
  ON dispute_evidence (dispute_id, created_at ASC);

CREATE TABLE IF NOT EXISTS dispute_events (
  id                    BIGSERIAL PRIMARY KEY,
  dispute_id            BIGINT NOT NULL REFERENCES order_disputes(id) ON DELETE CASCADE,
  actor_role            VARCHAR(16) NOT NULL,
  action                VARCHAR(40) NOT NULL,
  detail                TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispute_events_dispute
  ON dispute_events (dispute_id, created_at ASC);

INSERT INTO schema_migrations (name)
VALUES ('phase13_reviews_disputes')
ON CONFLICT (name) DO NOTHING;
