import { readFile } from 'node:fs/promises';
import { openDatabase } from '../server/database.mjs';
import { validateProduct } from '../server/validation.mjs';

// Import once. Normal application requests use SQLite, not DummyJSON.
// A JSON export can also be supplied for offline setup: npm run seed -- --file products.json
const db = openDatabase();
try {
  if (db.prepare('SELECT COUNT(*) AS count FROM products').get().count) {
    throw new Error('The catalog is not empty. Import skipped to protect existing products.');
  }
  const fileIndex = process.argv.indexOf('--file');
  let data;
  if (fileIndex >= 0) {
    if (!process.argv[fileIndex + 1]) throw new Error('Supply a JSON file after --file.');
    data = JSON.parse(await readFile(process.argv[fileIndex + 1], 'utf8'));
  } else {
    const response = await fetch('https://dummyjson.com/products?limit=0', { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Catalog import failed (${response.status}).`);
    data = await response.json();
  }
  if (!Array.isArray(data.products) || !data.products.length) throw new Error('No products found in the import.');
  db.exec('BEGIN IMMEDIATE');
  // Check again inside the transaction in case another import ran during the download.
  if (db.prepare('SELECT COUNT(*) AS count FROM products').get().count) throw new Error('The catalog is no longer empty.');
  const insert = db.prepare(`INSERT INTO products (title, category, brand, description, price_cents, stock, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const source of data.products) {
    const product = validateProduct(source);
    const details = {};
    for (const key of ['thumbnail', 'images', 'rating', 'sku', 'warrantyInformation', 'shippingInformation', 'returnPolicy']) {
      if (source[key] !== undefined) details[key] = source[key];
    }
    insert.run(product.title, product.category, product.brand, product.description, product.priceCents, product.stock, JSON.stringify(details));
  }
  db.exec('COMMIT');
  console.log(`Imported ${data.products.length} products. Future changes will be saved in SQLite.`);
} catch (error) {
  if (db.isTransaction) db.exec('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
