-- Phase 10 (blueprint Phase 1) — social marketplace foundations
-- Additive only: extends existing schema without breaking legacy flows.

DO $$ BEGIN
  CREATE TYPE gender_fit AS ENUM ('mens', 'womens', 'unisex', 'kids');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE offer_status AS ENUM ('pending', 'accepted', 'declined', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'completed';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Users: social + seller profile fields
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS handle VARCHAR(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_seller_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mpesa_number VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS national_id VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS available_balance NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_escrow NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS social_wa_notify BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS social_wa_notify_follows BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS social_wa_notify_likes BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS social_wa_notify_offers BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle_unique
  ON users (LOWER(handle))
  WHERE handle IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Products: mandatory listing metadata for social marketplace
-- ---------------------------------------------------------------------------

ALTER TABLE products ADD COLUMN IF NOT EXISTS size_label VARCHAR(80);
ALTER TABLE products ADD COLUMN IF NOT EXISTS gender_fit gender_fit;
ALTER TABLE products ADD COLUMN IF NOT EXISTS seller_user_id INT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_gender_fit ON products(gender_fit);
CREATE INDEX IF NOT EXISTS idx_products_seller_user ON products(seller_user_id);

-- ---------------------------------------------------------------------------
-- Orders: optional explicit seller user relation
-- ---------------------------------------------------------------------------

ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_id INT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_seller_id ON orders(seller_id);

-- ---------------------------------------------------------------------------
-- Social graph + interactions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS follows (
  id                  BIGSERIAL PRIMARY KEY,
  follower_user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT follows_no_self_follow CHECK (follower_user_id <> following_user_id),
  CONSTRAINT follows_unique_pair UNIQUE (follower_user_id, following_user_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_user_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_user_id);

CREATE TABLE IF NOT EXISTS product_likes (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_likes_unique_pair UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_likes_product ON product_likes(product_id);

CREATE TABLE IF NOT EXISTS offers (
  id              BIGSERIAL PRIMARY KEY,
  product_id      VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  buyer_user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_kes      NUMERIC(12, 2) NOT NULL CHECK (amount_kes > 0),
  status          offer_status NOT NULL DEFAULT 'pending',
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offers_product ON offers(product_id);
CREATE INDEX IF NOT EXISTS idx_offers_buyer ON offers(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_offers_seller ON offers(seller_user_id);
CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);

CREATE TABLE IF NOT EXISTS messages (
  id                BIGSERIAL PRIMARY KEY,
  sender_user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content           TEXT NOT NULL,
  is_flagged        BOOLEAN NOT NULL DEFAULT FALSE,
  moderation_note   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS offer_reminders (
  id              BIGSERIAL PRIMARY KEY,
  offer_id        BIGINT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  seller_user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  buyer_user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id      BIGINT REFERENCES messages(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offer_reminders_offer_created
  ON offer_reminders(offer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_reminders_seller_created
  ON offer_reminders(seller_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS offer_handled_queue (
  id              BIGSERIAL PRIMARY KEY,
  offer_id        BIGINT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  seller_user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  handled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT offer_handled_queue_unique_offer_seller UNIQUE (offer_id, seller_user_id)
);

CREATE INDEX IF NOT EXISTS idx_offer_handled_queue_seller_handled
  ON offer_handled_queue(seller_user_id, handled_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_handled_queue_offer
  ON offer_handled_queue(offer_id);

CREATE TABLE IF NOT EXISTS offer_handled_queue_events (
  id              BIGSERIAL PRIMARY KEY,
  offer_id        BIGINT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  seller_user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action          VARCHAR(24) NOT NULL CHECK (action IN ('handled', 'unhandled', 'reset')),
  source          VARCHAR(64) NOT NULL DEFAULT 'seller_dashboard',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offer_handled_events_seller_created
  ON offer_handled_queue_events(seller_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_handled_events_offer_created
  ON offer_handled_queue_events(offer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_reviews (
  id              BIGSERIAL PRIMARY KEY,
  order_id        INT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  seller_user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  buyer_user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating          INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_reviews_seller ON order_reviews(seller_user_id);
CREATE INDEX IF NOT EXISTS idx_order_reviews_buyer ON order_reviews(buyer_user_id);

INSERT INTO schema_migrations (name)
VALUES ('phase10_social_marketplace_foundation')
ON CONFLICT (name) DO NOTHING;
