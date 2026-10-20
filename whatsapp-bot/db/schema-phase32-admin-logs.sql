-- Phase 32: Dedicated Boss / admin action log (FORCE RELEASE, SUSPEND SHOP, …)
-- Complements audit_logs (order/dispatch trail) with an admin-ops stream.

CREATE TABLE IF NOT EXISTS admin_logs (
  id            BIGSERIAL PRIMARY KEY,
  actor_phone   VARCHAR(20),
  actor_label   VARCHAR(80),
  action        VARCHAR(100) NOT NULL,
  target_type   VARCHAR(40),
  target_id     VARCHAR(80),
  order_ref     VARCHAR(40),
  source        VARCHAR(80),
  success       BOOLEAN NOT NULL DEFAULT TRUE,
  message       TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_action
  ON admin_logs (action);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created
  ON admin_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_actor
  ON admin_logs (actor_phone);
CREATE INDEX IF NOT EXISTS idx_admin_logs_order
  ON admin_logs (UPPER(order_ref));
