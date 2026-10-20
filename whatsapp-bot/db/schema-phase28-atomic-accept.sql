-- Phase 28: Atomic accept locks + pickup SLA index
-- Accept uses SELECT … FOR UPDATE on delivery_dispatches; this index speeds the
-- 10-minute stale-pickup scanner that unassigns and re-offers.

CREATE INDEX IF NOT EXISTS idx_dispatches_accepted_pickup_sla
  ON delivery_dispatches (accepted_at)
  WHERE status = 'ACCEPTED' AND picked_up_at IS NULL;

-- Ensure custody starts UNASSIGNED for new offers (app also sets this on insert).
COMMENT ON COLUMN delivery_dispatches.custody_status IS
  'UNASSIGNED → ASSIGNED (accept) → IN_TRANSIT (pickup OTP) → …';
