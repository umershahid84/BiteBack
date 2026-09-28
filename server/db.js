const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer', 'restaurant')),
  payment_customer_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY,
  owner_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cuisine TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  zip TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  lat REAL,
  lng REAL,
  tax_rate_bps INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_ref TEXT NOT NULL,
  brand TEXT NOT NULL,
  last4 TEXT NOT NULL,
  exp_month INTEGER NOT NULL,
  exp_year INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  dietary TEXT NOT NULL DEFAULT '',
  image_path TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  menu_item_id INTEGER REFERENCES menu_items(id),
  image_path TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  dietary TEXT NOT NULL DEFAULT '',
  original_price_cents INTEGER NOT NULL CHECK (original_price_cents > 0),
  discount_pct INTEGER NOT NULL CHECK (discount_pct BETWEEN 1 AND 90),
  quantity_total INTEGER NOT NULL CHECK (quantity_total > 0),
  quantity_available INTEGER NOT NULL CHECK (quantity_available >= 0),
  pickup_start TEXT NOT NULL,
  pickup_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  offer_id INTEGER NOT NULL REFERENCES offers(id),
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  item_title TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  original_unit_price_cents INTEGER NOT NULL,
  discount_pct INTEGER NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  service_fee_cents INTEGER NOT NULL,
  tax_rate_bps INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  pin TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_payment', 'reserved', 'picked_up', 'cancelled', 'expired', 'failed')),
  payment_ref TEXT,
  card_label TEXT NOT NULL DEFAULT '',
  pickup_end TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  picked_up_at TEXT,
  closed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status, pickup_end);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant ON orders(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_pm_user ON payment_methods(user_id);
CREATE INDEX IF NOT EXISTS idx_menu_restaurant ON menu_items(restaurant_id, active);
`;

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Adds columns introduced after a database was first created.
function migrate(db) {
  const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has('offers', 'menu_item_id')) db.exec('ALTER TABLE offers ADD COLUMN menu_item_id INTEGER REFERENCES menu_items(id)');
  if (!has('offers', 'image_path')) db.exec('ALTER TABLE offers ADD COLUMN image_path TEXT');
}

// Runs fn inside a transaction; rolls back if it throws.
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDatabase, transaction };
