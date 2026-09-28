-- Phase 37: messages carry a kind and a payload, not just text.
--
-- Everything the inbox needs to do next -- escrow status cards, swap offers,
-- bundles, the pinned deal ledger, the post-sale fit check -- is "a message
-- that is not a sentence". Today `messages` has a single TEXT column, so each
-- of those would otherwise arrive as prose the client has to guess at.
--
-- kind defaults to 'text' and payload to '{}', so every existing row stays
-- valid and every existing reader keeps working on `content` alone.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS kind VARCHAR(32) NOT NULL DEFAULT 'text',
  -- Shape depends on kind. Validated in the repository, not here: a CHECK
  -- per kind would need a migration every time a card gains a field.
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Set for cards the system injects (escrow updates, delivery progress) so
  -- the client can style them apart from anything a person typed.
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE,
  -- Media that should stop being served after a while. NULL means keep.
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  -- One row per thread may be pinned to the top -- the deal ledger.
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$ BEGIN
  ALTER TABLE messages ADD CONSTRAINT messages_kind_known CHECK (
    kind IN (
      'text', 'image', 'voice', 'video',
      'escrow_status', 'deal_ledger', 'offer_card', 'swap_offer',
      'bundle', 'locked_drop', 'scratch_card', 'fit_check', 'nudge'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Reactions. A separate table rather than an array on the message: one row per
-- person per emoji makes "who reacted" and toggling off trivial, and the
-- primary key stops a double-tap counting twice.
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id  BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       VARCHAR(16) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_msg ON message_reactions (message_id);

-- Thread lookups already scan by pair + time; pinned and unexpired lookups are
-- the two new access patterns.
CREATE INDEX IF NOT EXISTS idx_messages_pinned
  ON messages (sender_user_id, receiver_user_id)
  WHERE is_pinned = TRUE;

CREATE INDEX IF NOT EXISTS idx_messages_expiring
  ON messages (expires_at)
  WHERE expires_at IS NOT NULL;

INSERT INTO schema_migrations (name)
VALUES ('phase37_rich_messages')
ON CONFLICT (name) DO NOTHING;
