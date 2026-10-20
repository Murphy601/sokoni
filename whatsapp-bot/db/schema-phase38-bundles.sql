-- Phase 38: bundles -- several items from one seller, bought at one price.
--
-- Deliberately its own table rather than a column on `offers`. An offer has
-- product_id NOT NULL and the whole accept -> STK -> escrow path reads it;
-- making it nullable to fit bundles would loosen a constraint on the busiest
-- money path in the system to serve a feature that can carry its own.
--
-- A bundle is a proposal. When it is accepted the items become an ordinary
-- multi-line cart order, so escrow, dispatch and payouts are unchanged --
-- bundles add negotiation, not a second way to move money.

DO $$ BEGIN
  CREATE TYPE bundle_status AS ENUM ('pending', 'accepted', 'countered', 'declined', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS bundles (
  id              BIGSERIAL PRIMARY KEY,
  buyer_user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- What the two sides are currently discussing. Updated on a counter rather
  -- than inserting a new row, so a thread has one bundle being negotiated and
  -- not a pile of near-identical ones.
  amount_kes      NUMERIC(12, 2) NOT NULL CHECK (amount_kes > 0),
  -- Sum of list prices when the bundle was proposed. Frozen: a seller
  -- repricing an item later must not silently change what was agreed.
  list_total_kes  NUMERIC(12, 2) NOT NULL CHECK (list_total_kes > 0),
  status          bundle_status NOT NULL DEFAULT 'pending',
  -- Who moved last, so the UI knows whose turn it is.
  last_actor      VARCHAR(8) NOT NULL DEFAULT 'buyer' CHECK (last_actor IN ('buyer', 'seller')),
  order_ref       VARCHAR(40),
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bundles_not_above_list CHECK (amount_kes <= list_total_kes),
  CONSTRAINT bundles_two_parties CHECK (buyer_user_id <> seller_user_id)
);

CREATE TABLE IF NOT EXISTS bundle_items (
  bundle_id   BIGINT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  product_id  VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- List price at proposal time, for the same reason list_total_kes is frozen.
  list_kes    NUMERIC(12, 2) NOT NULL CHECK (list_kes > 0),
  position    SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (bundle_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_bundles_buyer ON bundles (buyer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bundles_seller ON bundles (seller_user_id, created_at DESC);

-- One live negotiation per pair. A second pending bundle in the same thread
-- would leave both sides unsure which price they had agreed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bundles_one_pending
  ON bundles (buyer_user_id, seller_user_id)
  WHERE status IN ('pending', 'countered');

INSERT INTO schema_migrations (name)
VALUES ('phase38_bundles')
ON CONFLICT (name) DO NOTHING;
