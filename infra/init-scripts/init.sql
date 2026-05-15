-- ─── Initial Database Setup ──────────────────────────────────────────────────
-- This script runs automatically when the PostgreSQL container starts
-- for the first time (via docker-entrypoint-initdb.d).

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users / Customers ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
  id            TEXT PRIMARY KEY DEFAULT 'cust_' || gen_random_uuid()::text,
  email         TEXT NOT NULL UNIQUE,
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  has_account   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customers_email ON customers (lower(email));

-- ── Auth Sessions ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auth_sessions (
  token          TEXT PRIMARY KEY,
  refresh_token  TEXT NOT NULL UNIQUE,
  customer_id    TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_family   TEXT NOT NULL,
  used           BOOLEAN NOT NULL DEFAULT false,
  expires_at     TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_customer ON auth_sessions (customer_id);
CREATE INDEX idx_sessions_family   ON auth_sessions (token_family);

-- ── Products ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  handle      TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  category    TEXT NOT NULL DEFAULT '',
  thumbnail   TEXT,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_variants (
  id                 TEXT PRIMARY KEY,
  product_id         TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  price              INTEGER NOT NULL DEFAULT 0,
  inventory_quantity INTEGER NOT NULL DEFAULT 0,
  sku                TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_variants_product ON product_variants (product_id);

-- ── Orders ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
  id                 TEXT PRIMARY KEY,
  status             TEXT NOT NULL DEFAULT 'pending',
  email              TEXT NOT NULL,
  customer_id        TEXT REFERENCES customers(id),
  subtotal           INTEGER NOT NULL DEFAULT 0,
  shipping_total     INTEGER NOT NULL DEFAULT 0,
  tax_total          INTEGER NOT NULL DEFAULT 0,
  discount_amount    INTEGER NOT NULL DEFAULT 0,
  total              INTEGER NOT NULL DEFAULT 0,
  discount_code      TEXT,
  payment_status     TEXT NOT NULL DEFAULT 'awaiting',
  fulfillment_status TEXT NOT NULL DEFAULT 'not_fulfilled',
  shipping_address   JSONB,
  billing_address    JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL,
  variant_id    TEXT NOT NULL,
  title         TEXT NOT NULL,
  variant_title TEXT NOT NULL,
  thumbnail     TEXT,
  price         INTEGER NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1,
  subtotal      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_order_items_order ON order_items (order_id);

-- ── Discounts ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS discounts (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,
  type                  TEXT NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value                 INTEGER NOT NULL,
  max_uses_total        INTEGER,
  max_uses_per_customer INTEGER NOT NULL DEFAULT 1,
  current_uses_total    INTEGER NOT NULL DEFAULT 0,
  active                BOOLEAN NOT NULL DEFAULT true,
  starts_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS discount_usage (
  discount_id TEXT NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  used_count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (discount_id, customer_id)
);

-- ── Commits (progression system) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS commits (
  id            TEXT PRIMARY KEY,
  message       TEXT NOT NULL,
  repo          TEXT NOT NULL DEFAULT '',
  author_id     TEXT,
  points        INTEGER NOT NULL DEFAULT 0,
  linked_issues TEXT[] NOT NULL DEFAULT '{}',
  pr_url        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── User Progression ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_progression (
  user_id              TEXT PRIMARY KEY,
  total_xp             INTEGER NOT NULL DEFAULT 0,
  commit_count         INTEGER NOT NULL DEFAULT 0,
  current_streak       INTEGER NOT NULL DEFAULT 0,
  longest_streak       INTEGER NOT NULL DEFAULT 0,
  last_commit_date     DATE,
  unlocked_milestones  TEXT[] NOT NULL DEFAULT '{}'
);
