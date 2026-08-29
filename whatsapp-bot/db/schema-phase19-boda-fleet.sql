-- Phase 19: Vetted Sokoni boda fleet (Nairobi / Thika ops zones)
-- Order refs are SKN-#### strings (NOT integer FKs to Postgres orders.id).

CREATE TABLE IF NOT EXISTS riders (
  id                    SERIAL PRIMARY KEY,
  full_name             VARCHAR(120) NOT NULL,
  phone                 VARCHAR(20) NOT NULL,
  national_id           VARCHAR(32),
  operating_town        VARCHAR(20) NOT NULL DEFAULT 'NAIROBI',
  stage_location        VARCHAR(120),
  motorbike_plate       VARCHAR(32),
  license_class         VARCHAR(40),
  guarantor_name        VARCHAR(120),
  guarantor_phone       VARCHAR(20),
  national_id_front_url TEXT,
  national_id_back_url  TEXT,
  license_url           TEXT,
  logbook_url           TEXT,
  good_conduct_url      TEXT,
  ntsa_badge_url        TEXT,
  stage_letter_url      TEXT,
  verification_status   VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  is_available          BOOLEAN NOT NULL DEFAULT TRUE,
  rating                NUMERIC(3, 2) NOT NULL DEFAULT 5.00,
  suspend_reason        TEXT,
  suspended_at          TIMESTAMPTZ,
  suspended_order_ref   VARCHAR(40),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT riders_phone_unique UNIQUE (phone),
  CONSTRAINT riders_national_id_unique UNIQUE (national_id),
  CONSTRAINT riders_plate_unique UNIQUE (motorbike_plate),
  CONSTRAINT riders_town_check CHECK (operating_town IN ('NAIROBI', 'THIKA')),
  CONSTRAINT riders_status_check CHECK (
    verification_status IN ('PENDING', 'VERIFIED', 'SUSPENDED', 'REJECTED')
  )
);

CREATE INDEX IF NOT EXISTS idx_riders_available_zone
  ON riders (operating_town, verification_status, is_available)
  WHERE verification_status = 'VERIFIED' AND is_available = TRUE;

CREATE TABLE IF NOT EXISTS delivery_dispatches (
  id                  BIGSERIAL PRIMARY KEY,
  order_ref           VARCHAR(40) NOT NULL,
  seller_phone        VARCHAR(20),
  seller_user_id      INT REFERENCES users(id) ON DELETE SET NULL,
  rider_id            INT REFERENCES riders(id) ON DELETE SET NULL,
  pickup_address      TEXT NOT NULL,
  delivery_address    TEXT NOT NULL,
  delivery_fee_kes    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  operating_town      VARCHAR(20) NOT NULL DEFAULT 'NAIROBI',
  status              VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
  delivery_otp_hash   VARCHAR(128),
  delivery_otp_sent_at TIMESTAMPTZ,
  accepted_at         TIMESTAMPTZ,
  picked_up_at        TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  fee_status          VARCHAR(30) NOT NULL DEFAULT 'HELD',
  broadcast_rider_ids INT[] DEFAULT '{}',
  meta                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT delivery_dispatches_town_check CHECK (operating_town IN ('NAIROBI', 'THIKA')),
  CONSTRAINT delivery_dispatches_status_check CHECK (
    status IN (
      'REQUESTED', 'ACCEPTED', 'PICKED_UP', 'OTP_SENT', 'DELIVERED', 'CANCELLED', 'DISPUTED'
    )
  ),
  CONSTRAINT delivery_dispatches_fee_check CHECK (
    fee_status IN ('HELD', 'RELEASED', 'FORFEITED', 'PENDING_MPESA')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_dispatches_open_order
  ON delivery_dispatches (UPPER(order_ref))
  WHERE status IN ('REQUESTED', 'ACCEPTED', 'PICKED_UP', 'OTP_SENT');

CREATE INDEX IF NOT EXISTS idx_delivery_dispatches_rider
  ON delivery_dispatches (rider_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_dispatches_status
  ON delivery_dispatches (status, created_at DESC);
