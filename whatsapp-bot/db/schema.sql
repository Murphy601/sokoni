-- Sokoni Mall Phase 1 — PostgreSQL schema
-- Run: node src/db/migrate.js   (from whatsapp-bot/)
-- Seed: node ../../scripts/migrate-catalog-to-db.mjs   (from repo root)

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE item_condition AS ENUM (
    'brand_new_with_tags',
    'brand_new_without_tags',
    'like_new',
    'gently_used',
    'fair_condition'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('buyer', 'seller', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'pending',
    'paid',
    'confirmed',
    'packed',
    'dispatched',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed',
    'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('mpesa_stk', 'card', 'cod', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE shipment_status AS ENUM (
    'pending',
    'label_ready',
    'dropped_off',
    'in_transit',
    'at_pickup_point',
    'delivered',
    'failed',
    'returned'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Users & sellers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  phone           VARCHAR(20) UNIQUE,
  email           VARCHAR(255) UNIQUE,
  display_name    VARCHAR(120),
  role            user_role NOT NULL DEFAULT 'buyer',
  password_hash   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sellers (
  id              SERIAL PRIMARY KEY,
  user_id         INT REFERENCES users(id) ON DELETE SET NULL,
  business_name   VARCHAR(255) NOT NULL,
  slug            VARCHAR(100) UNIQUE NOT NULL,
  city            VARCHAR(100),
  bio             TEXT,
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sellers_user ON sellers(user_id);
CREATE INDEX IF NOT EXISTS idx_sellers_slug ON sellers(slug);

-- ---------------------------------------------------------------------------
-- Products (new + secondhand; legacy id kept e.g. pt-001)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS products (
  id                  VARCHAR(64) PRIMARY KEY,
  seller_id           INT REFERENCES sellers(id) ON DELETE SET NULL,
  title               VARCHAR(255) NOT NULL,
  description         TEXT,
  category            VARCHAR(100) NOT NULL,
  sub_category        VARCHAR(100),
  brand               VARCHAR(100),
  color               VARCHAR(80),

  is_secondhand       BOOLEAN NOT NULL DEFAULT FALSE,
  condition           item_condition NOT NULL DEFAULT 'brand_new_without_tags',
  stock_quantity      INT NOT NULL DEFAULT 1 CHECK (stock_quantity >= 0),

  price_kes           NUMERIC(12, 2),
  price_usd           NUMERIC(10, 2),
  source_price_kes    NUMERIC(12, 2),
  original_price_kes  NUMERIC(12, 2),
  retail_per_ml_kes   NUMERIC(10, 2),
  volume_ml           INT,

  rating              NUMERIC(3, 2) DEFAULT 4.5,
  review_count        INT NOT NULL DEFAULT 0,

  source              VARCHAR(50),
  source_url          TEXT,
  scope               VARCHAR(20) NOT NULL DEFAULT 'local',
  fulfillment         VARCHAR(20) DEFAULT 'store',
  payment             VARCHAR(20) DEFAULT 'cod',
  emoji               VARCHAR(16),
  tags                JSONB NOT NULL DEFAULT '[]'::jsonb,

  in_stock            BOOLEAN NOT NULL DEFAULT TRUE,
  is_sold             BOOLEAN NOT NULL DEFAULT FALSE,
  tracking_code       VARCHAR(50) UNIQUE,

  primary_image_url   TEXT,
  image_key           VARCHAR(32),
  image_hash          VARCHAR(32),
  upload_message_id   VARCHAR(128),
  est_delivery_days   VARCHAR(64),

  legacy_json         JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category, sub_category);
CREATE INDEX IF NOT EXISTS idx_products_in_stock ON products(in_stock) WHERE in_stock = TRUE AND is_sold = FALSE;
CREATE INDEX IF NOT EXISTS idx_products_secondhand ON products(is_secondhand);
CREATE INDEX IF NOT EXISTS idx_products_price_kes ON products(price_kes);
CREATE INDEX IF NOT EXISTS idx_products_scope ON products(scope);
CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING GIN(tags);

CREATE TABLE IF NOT EXISTS product_images (
  id              SERIAL PRIMARY KEY,
  product_id      VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, sort_order);

-- ---------------------------------------------------------------------------
-- Orders, payments, shipments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS orders (
  id                  SERIAL PRIMARY KEY,
  tracking_code       VARCHAR(50) UNIQUE NOT NULL,
  buyer_id            INT REFERENCES users(id) ON DELETE SET NULL,
  buyer_phone         VARCHAR(20),
  buyer_name          VARCHAR(120),
  status              order_status NOT NULL DEFAULT 'pending',
  subtotal_kes        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  shipping_kes        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_kes           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  delivery_address    TEXT,
  delivery_city       VARCHAR(100),
  delivery_notes      TEXT,
  pickup_point_id     VARCHAR(64),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_tracking ON orders(tracking_code);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_phone ON orders(buyer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id              SERIAL PRIMARY KEY,
  order_id        INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      VARCHAR(64) REFERENCES products(id) ON DELETE SET NULL,
  seller_id       INT REFERENCES sellers(id) ON DELETE SET NULL,
  title           VARCHAR(255) NOT NULL,
  quantity        INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_kes  NUMERIC(12, 2) NOT NULL,
  condition       item_condition,
  is_secondhand   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS payments (
  id                  SERIAL PRIMARY KEY,
  order_id            INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method              payment_method NOT NULL DEFAULT 'cod',
  status              payment_status NOT NULL DEFAULT 'pending',
  amount_kes          NUMERIC(12, 2) NOT NULL,
  mpesa_receipt       VARCHAR(64),
  mpesa_phone         VARCHAR(20),
  external_ref        VARCHAR(128),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

CREATE TABLE IF NOT EXISTS shipments (
  id                  SERIAL PRIMARY KEY,
  order_id            INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  seller_id           INT REFERENCES sellers(id) ON DELETE SET NULL,
  status              shipment_status NOT NULL DEFAULT 'pending',
  courier             VARCHAR(80),
  tracking_ref        VARCHAR(128),
  drop_off_code       VARCHAR(64),
  label_url           TEXT,
  rider_name          VARCHAR(120),
  rider_phone         VARCHAR(20),
  eta_note            TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  dispatched_at       TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);

-- ---------------------------------------------------------------------------
-- Schema version marker
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL UNIQUE,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (name)
VALUES ('phase1_initial')
ON CONFLICT (name) DO NOTHING;
