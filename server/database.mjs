import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function openDatabase(path = process.env.DATABASE_PATH || './data/stockroom.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
      stock INTEGER NOT NULL CHECK(stock >= 0),
      details TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('new', 'processing', 'completed')),
      items TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      checkout_key TEXT NOT NULL UNIQUE,
      owner_session TEXT NOT NULL,
      request_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    PRAGMA user_version = 1;
  `);
  return db;
}

export function productFromRow(row) {
  if (!row) return null;
  return {
    ...JSON.parse(row.details), id: row.id, title: row.title, category: row.category,
    brand: row.brand, description: row.description, price: row.price_cents / 100,
    stock: row.stock, version: row.version,
  };
}

export function orderFromRow(row) {
  return {
    reference: row.reference, createdAt: row.created_at, status: row.status,
    items: JSON.parse(row.items), quantity: row.quantity, totalCents: row.total_cents,
    mode: 'demo',
  };
}
