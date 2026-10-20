-- Phase 25: Seller-managed upcountry waybill / parcel tracking (order_ref = SKN string)

CREATE TABLE IF NOT EXISTS upcountry_shipments (
  id                BIGSERIAL PRIMARY KEY,
  order_ref         VARCHAR(40) NOT NULL,
  seller_phone      VARCHAR(20),
  seller_user_id    INT,
  courier_name      VARCHAR(100) NOT NULL,
  waybill_number    VARCHAR(100) NOT NULL,
  receipt_photo_url TEXT,
  dispatch_notes    TEXT,
  status            VARCHAR(30) NOT NULL DEFAULT 'DISPATCHED',
  dispatched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at      TIMESTAMPTZ,
  meta              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT upcountry_shipments_status_check CHECK (
    status IN ('DISPATCHED', 'DELIVERED_CONFIRMED', 'DISPUTED', 'AUTO_RELEASED')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_upcountry_shipments_order
  ON upcountry_shipments (order_ref);

CREATE INDEX IF NOT EXISTS idx_upcountry_shipments_status
  ON upcountry_shipments (status, dispatched_at);
