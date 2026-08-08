-- Phase 14 — email/password site accounts
-- Additive: users.email + password_hash already exist in base schema.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;

-- Unique email index — skip if legacy duplicate emails exist (do not block migrate).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_email_unique') THEN
    IF EXISTS (
      SELECT 1 FROM users
      WHERE email IS NOT NULL
      GROUP BY LOWER(email)
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'phase14: skipping idx_users_email_unique (duplicate emails present)';
    ELSE
      CREATE UNIQUE INDEX idx_users_email_unique
        ON users (LOWER(email))
        WHERE email IS NOT NULL;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_password_reset_token
  ON users (password_reset_token)
  WHERE password_reset_token IS NOT NULL;
