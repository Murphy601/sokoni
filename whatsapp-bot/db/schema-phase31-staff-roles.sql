-- Phase 31: Executive staff roles (RBAC for WhatsApp / ops desk)
DO $$ BEGIN
  CREATE TYPE staff_role AS ENUM (
    'SUPER_ADMIN',
    'DISPUTE_MANAGER',
    'LOGISTICS_LEAD',
    'SUPPORT_AGENT'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS staff_roles (
  id            BIGSERIAL PRIMARY KEY,
  phone         VARCHAR(20) NOT NULL,
  role          staff_role NOT NULL DEFAULT 'SUPPORT_AGENT',
  display_name  VARCHAR(120),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_roles_phone
  ON staff_roles (regexp_replace(phone, '\D', '', 'g'));

CREATE INDEX IF NOT EXISTS idx_staff_roles_active_role
  ON staff_roles (role)
  WHERE active = TRUE;

INSERT INTO schema_migrations (name)
VALUES ('phase31_staff_roles')
ON CONFLICT DO NOTHING;
