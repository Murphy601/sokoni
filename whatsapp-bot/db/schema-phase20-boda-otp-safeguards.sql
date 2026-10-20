-- Phase 20: Boda OTP safeguards — brute-force lock, geofence, dispute window, audit trail

ALTER TABLE delivery_dispatches
  ADD COLUMN IF NOT EXISTS otp_failed_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS otp_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dropoff_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dropoff_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS rider_confirm_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS rider_confirm_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS rider_location_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispute_window_ends_at TIMESTAMPTZ;

-- Widen status / fee enums (drop + recreate checks)
ALTER TABLE delivery_dispatches DROP CONSTRAINT IF EXISTS delivery_dispatches_status_check;
ALTER TABLE delivery_dispatches ADD CONSTRAINT delivery_dispatches_status_check CHECK (
  status IN (
    'REQUESTED', 'ACCEPTED', 'PICKED_UP', 'OTP_SENT', 'OTP_LOCKED',
    'DELIVERED', 'CANCELLED', 'DISPUTED'
  )
);

ALTER TABLE delivery_dispatches DROP CONSTRAINT IF EXISTS delivery_dispatches_fee_check;
ALTER TABLE delivery_dispatches ADD CONSTRAINT delivery_dispatches_fee_check CHECK (
  fee_status IN ('HELD', 'RELEASED', 'FORFEITED', 'PENDING_MPESA', 'ON_HOLD')
);

-- Open-order unique index must include OTP_LOCKED
DROP INDEX IF EXISTS idx_delivery_dispatches_open_order;
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_dispatches_open_order
  ON delivery_dispatches (UPPER(order_ref))
  WHERE status IN ('REQUESTED', 'ACCEPTED', 'PICKED_UP', 'OTP_SENT', 'OTP_LOCKED');

CREATE TABLE IF NOT EXISTS delivery_otp_audit (
  id                BIGSERIAL PRIMARY KEY,
  order_ref         VARCHAR(40) NOT NULL,
  dispatch_id       BIGINT REFERENCES delivery_dispatches(id) ON DELETE SET NULL,
  rider_id          INT REFERENCES riders(id) ON DELETE SET NULL,
  otp_entered       VARCHAR(8),
  otp_match         BOOLEAN NOT NULL DEFAULT FALSE,
  submission_time   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rider_gps_lat     DOUBLE PRECISION,
  rider_gps_lng     DOUBLE PRECISION,
  distance_m        NUMERIC(12, 2),
  geofence_ok       BOOLEAN,
  escrow_status     VARCHAR(30),
  result            VARCHAR(40) NOT NULL DEFAULT 'ATTEMPT',
  meta              JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_delivery_otp_audit_order
  ON delivery_otp_audit (UPPER(order_ref), submission_time DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_otp_audit_rider
  ON delivery_otp_audit (rider_id, submission_time DESC);
