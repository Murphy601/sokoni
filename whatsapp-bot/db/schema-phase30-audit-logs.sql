-- Phase 30: Launch fail-safes — audit_logs + widen dispatch status for no-show

-- Immutable-ish audit trail (append-only from app; no UPDATE/DELETE expected)
CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  order_ref     VARCHAR(40),
  dispatch_id   BIGINT,
  rider_id      INT,
  actor_phone   VARCHAR(20),
  actor_role    VARCHAR(20),
  action        VARCHAR(100) NOT NULL,
  from_status   VARCHAR(40),
  to_status     VARCHAR(40),
  from_custody  VARCHAR(40),
  to_custody    VARCHAR(40),
  source        VARCHAR(80),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_order_ref
  ON audit_logs (UPPER(order_ref));
CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs (actor_phone);

-- Allow DELIVERY_FAILED used by buyer no-show return flow
ALTER TABLE delivery_dispatches DROP CONSTRAINT IF EXISTS delivery_dispatches_status_check;
ALTER TABLE delivery_dispatches ADD CONSTRAINT delivery_dispatches_status_check CHECK (
  status IN (
    'REQUESTED', 'ACCEPTED', 'PICKED_UP', 'OTP_SENT', 'OTP_LOCKED',
    'DELIVERED', 'DELIVERY_FAILED', 'CANCELLED', 'DISPUTED'
  )
);
