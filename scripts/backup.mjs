import { backup } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openDatabase } from '../server/database.mjs';

// SQLite's backup API produces a consistent snapshot even when the app is running.
const directory = resolve('data/backups');
await mkdir(directory, { recursive: true });
const destination = resolve(directory, `stockroom-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
const db = openDatabase();
try {
  await backup(db, destination);
  console.log(`Database backup saved to ${destination}`);
} finally {
  db.close();
}
