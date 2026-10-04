-- Phase 42: an approval can run only once, and only while it is still fresh.
--
-- Phase 41 already created the table. This adds the expiry and the status
-- the sweeper writes when the two hours pass. A second click finds no
-- PENDING row and does nothing.

ALTER TABLE pending_agent_actions
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE pending_agent_actions
   SET expires_at = created_at + INTERVAL '2 hours'
 WHERE expires_at IS NULL;

ALTER TABLE pending_agent_actions
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '2 hours');

ALTER TABLE pending_agent_actions
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE pending_agent_actions DROP CONSTRAINT IF EXISTS pending_agent_actions_status_check;
ALTER TABLE pending_agent_actions ADD CONSTRAINT pending_agent_actions_status_check CHECK (
  status IN ('PENDING', 'APPROVED', 'REJECTED', 'FAILED', 'EXPIRED')
);

-- One live release proposal per order. An expired row no longer holds the slot,
-- so a later window can ask again. A rejection holds it, so the ticker cannot
-- ask again after a person said no.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_release_open
  ON pending_agent_actions (order_id)
  WHERE action_type = 'RELEASE_ESCROW'
    AND status IN ('PENDING', 'APPROVED', 'REJECTED');

INSERT INTO schema_migrations (name)
VALUES ('phase42_action_guards')
ON CONFLICT (name) DO NOTHING;
