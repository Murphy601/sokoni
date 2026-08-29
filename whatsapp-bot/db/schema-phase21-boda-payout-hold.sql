-- Phase 21: Explicit 15-min rider payout hold window (HOLD_ESCROW → RELEASED | FROZEN)

ALTER TABLE delivery_dispatches
  ADD COLUMN IF NOT EXISTS payout_status VARCHAR(30) NOT NULL DEFAULT 'HOLD_ESCROW',
  ADD COLUMN IF NOT EXISTS payout_hold_until TIMESTAMPTZ;

-- Backfill from dispute_window_ends_at when present
UPDATE delivery_dispatches
   SET payout_hold_until = COALESCE(payout_hold_until, dispute_window_ends_at)
 WHERE dispute_window_ends_at IS NOT NULL
   AND payout_hold_until IS NULL;

UPDATE delivery_dispatches
   SET payout_status = CASE
         WHEN fee_status = 'RELEASED' THEN 'RELEASED'
         WHEN fee_status = 'ON_HOLD' OR status = 'DISPUTED' THEN 'FROZEN'
         WHEN status = 'DELIVERED' AND fee_status = 'PENDING_MPESA' THEN 'HOLD_ESCROW'
         ELSE payout_status
       END;

ALTER TABLE delivery_dispatches DROP CONSTRAINT IF EXISTS delivery_dispatches_payout_status_check;
ALTER TABLE delivery_dispatches ADD CONSTRAINT delivery_dispatches_payout_status_check CHECK (
  payout_status IN ('HOLD_ESCROW', 'FROZEN', 'RELEASED')
);

CREATE INDEX IF NOT EXISTS idx_delivery_dispatches_payout_hold
  ON delivery_dispatches (payout_status, payout_hold_until)
  WHERE payout_status = 'HOLD_ESCROW' AND payout_hold_until IS NOT NULL;
