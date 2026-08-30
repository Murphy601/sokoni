-- Phase 34: Sokoni Points + Pamoja pools + rider daily quests
-- Economy: 1000 points ≈ KES 100 credit (low earn rates, redeem when ready)

CREATE TABLE IF NOT EXISTS sokoni_points_wallets (
  subject_type   VARCHAR(16) NOT NULL CHECK (subject_type IN ('buyer', 'seller', 'rider')),
  subject_id     INT NOT NULL,
  balance        INT NOT NULL DEFAULT 0,
  lifetime_earned INT NOT NULL DEFAULT 0,
  lifetime_redeemed INT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subject_type, subject_id)
);

CREATE TABLE IF NOT EXISTS sokoni_points_ledger (
  id             BIGSERIAL PRIMARY KEY,
  subject_type   VARCHAR(16) NOT NULL,
  subject_id     INT NOT NULL,
  delta          INT NOT NULL,
  balance_after  INT NOT NULL,
  reason         VARCHAR(64) NOT NULL,
  ref            VARCHAR(120),
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sokoni_points_ledger_subject
  ON sokoni_points_ledger (subject_type, subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pamoja_pools (
  id             BIGSERIAL PRIMARY KEY,
  public_code    VARCHAR(16) NOT NULL UNIQUE,
  product_id     VARCHAR(120) NOT NULL,
  leader_phone   VARCHAR(32),
  leader_user_id INT,
  target_size    SMALLINT NOT NULL DEFAULT 3 CHECK (target_size BETWEEN 3 AND 5),
  member_count   SMALLINT NOT NULL DEFAULT 1,
  discount_pct   SMALLINT NOT NULL DEFAULT 8,
  status         VARCHAR(16) NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'filled', 'expired', 'cancelled')),
  expires_at     TIMESTAMPTZ NOT NULL,
  filled_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pamoja_pools_product ON pamoja_pools (product_id, status);
CREATE INDEX IF NOT EXISTS idx_pamoja_pools_code ON pamoja_pools (public_code);

CREATE TABLE IF NOT EXISTS pamoja_members (
  pool_id        BIGINT NOT NULL REFERENCES pamoja_pools(id) ON DELETE CASCADE,
  member_key     VARCHAR(64) NOT NULL,
  phone          VARCHAR(32),
  user_id        INT,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pool_id, member_key)
);

CREATE TABLE IF NOT EXISTS rider_daily_quests (
  rider_id       INT NOT NULL,
  quest_date     DATE NOT NULL,
  target_deliveries SMALLINT NOT NULL DEFAULT 8,
  progress       SMALLINT NOT NULL DEFAULT 0,
  completed      BOOLEAN NOT NULL DEFAULT FALSE,
  points_awarded INT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rider_id, quest_date)
);

ALTER TABLE sellers ADD COLUMN IF NOT EXISTS is_verified_store BOOLEAN;
UPDATE sellers SET is_verified_store = COALESCE(is_verified_store, is_verified, FALSE)
 WHERE is_verified_store IS NULL;
