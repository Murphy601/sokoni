-- Phase 43: one escrow release proposal per order, and a dispute can stop a payout.
--
-- FAILED_DUE_TO_DISPUTE is longer than the phase 41 status column, so the
-- column is widened first. A second RELEASE_ESCROW row for the same order is
-- rejected even after the first one expires.

ALTER TABLE pending_agent_actions
  ALTER COLUMN status TYPE VARCHAR(32);

ALTER TABLE pending_agent_actions DROP CONSTRAINT IF EXISTS pending_agent_actions_status_check;
ALTER TABLE pending_agent_actions ADD CONSTRAINT pending_agent_actions_status_check CHECK (
  status IN ('PENDING', 'APPROVED', 'REJECTED', 'FAILED', 'EXPIRED', 'FAILED_DUE_TO_DISPUTE')
);

UPDATE pending_agent_actions
   SET order_id = regexp_replace(UPPER(TRIM(order_id)), '^(SKN)(\d)', '\1-\2')
 WHERE order_id ~* '^skn\d';

UPDATE pending_agent_actions
   SET order_id = UPPER(TRIM(order_id))
 WHERE order_id IS DISTINCT FROM UPPER(TRIM(order_id));

DELETE FROM pending_agent_actions a
 USING pending_agent_actions b
 WHERE a.action_type = 'RELEASE_ESCROW'
   AND b.action_type = 'RELEASE_ESCROW'
   AND a.order_id = b.order_id
   AND a.id < b.id;

DELETE FROM pending_agent_actions a
 USING pending_agent_actions b
 WHERE a.action_type = 'PROMPT_STK'
   AND b.action_type = 'PROMPT_STK'
   AND a.status = 'PENDING'
   AND b.status = 'PENDING'
   AND a.order_id = b.order_id
   AND a.id < b.id;

DROP INDEX IF EXISTS idx_agent_release_open;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_release_once
  ON pending_agent_actions (order_id)
  WHERE action_type = 'RELEASE_ESCROW';

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_stk_pending
  ON pending_agent_actions (order_id)
  WHERE action_type = 'PROMPT_STK'
    AND status = 'PENDING';

INSERT INTO schema_migrations (name)
VALUES ('phase43_action_once')
ON CONFLICT (name) DO NOTHING;
