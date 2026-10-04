-- Phase 41: proposals an agent is not allowed to run by itself.
--
-- Approving a row calls the existing payout or checkout function. The agent
-- does not choose the amount. Rejecting a row changes nothing else.

CREATE TABLE IF NOT EXISTS pending_agent_actions (
  id            BIGSERIAL PRIMARY KEY,
  action_type   VARCHAR(32) NOT NULL,
  order_id      VARCHAR(40) NOT NULL,
  reason        TEXT,
  agent_name    VARCHAR(40) NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  result_code   VARCHAR(64),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  CONSTRAINT pending_agent_actions_type_check CHECK (
    action_type IN ('RELEASE_ESCROW', 'PROMPT_STK')
  ),
  CONSTRAINT pending_agent_actions_status_check CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED', 'FAILED')
  )
);

CREATE INDEX IF NOT EXISTS idx_pending_agent_actions_status
  ON pending_agent_actions (status, created_at DESC);

INSERT INTO schema_migrations (name)
VALUES ('phase41_agent_actions')
ON CONFLICT (name) DO NOTHING;
