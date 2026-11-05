import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openDatabase, productFromRow, orderFromRow } from './database.mjs';
import { digest, createSession, verifyPassword } from './auth.mjs';
import { HttpError, validateProduct, validateCheckout } from './validation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const statuses = new Set(['new', 'processing', 'completed']);
const publicFiles = new Set(['index.html', 'admin.css', 'storefront.css']);

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Send JSON data.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Invalid JSON.'); }
}

export function createApplication(config = {}) {
  const db = openDatabase(config.databasePath);
  const origin = new URL(config.origin || 'http://localhost:3000');
  const secure = config.secureCookies ?? origin.protocol === 'https:';
  const cookieName = secure ? '__Host-stockroom_session' : 'stockroom_session';
  const limits = new Map();
  let activeLogins = 0;

  function rateLimit(key, maximum, duration) {
    const now = Date.now();
    for (const [entry, value] of limits) if (value.until < now) limits.delete(entry);
    const value = limits.get(key) || { count: 0, until: now + duration };
    if (++value.count > maximum || limits.size > 10000) throw new HttpError(429, 'Too many attempts. Please try again later.');
    limits.set(key, value);
  }

  function setSession(res, adminId = null) {
    const { token, session } = createSession(db, adminId);
    res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor((session.expires_at - Date.now()) / 1000)}${secure ? '; Secure' : ''}`);
    return session;
  }

  function sessionFor(req) {
    const cookie = (req.headers.cookie || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(`${cookieName}=`));
    const token = cookie?.slice(cookieName.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(digest(token), Date.now()) || null;
  }

  function requireAdmin(session) {
    if (!session?.admin_id) throw new HttpError(401, 'Sign in as an admin to continue.');
  }

  function describeSession(session) {
    const admin = session.admin_id ? db.prepare('SELECT email FROM admins WHERE id = ?').get(session.admin_id) : null;
    return { admin: admin ? { email: admin.email } : null, csrfToken: session.csrf };
  }

  function checkout(body, session) {
    const input = validateCheckout(body);
    const fingerprint = digest(JSON.stringify({ items: input.items, expectedTotalCents: input.expectedTotalCents }));
    // Every stock decrement and the order insert commit together, including across server processes.
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare('SELECT * FROM orders WHERE checkout_key = ?').get(input.checkoutKey);
      if (previous) {
        if (previous.owner_session !== session.token_hash || previous.request_hash !== fingerprint) throw new HttpError(409, 'This checkout key has already been used.');
        db.exec('COMMIT');
        return orderFromRow(previous);
      }
      let quantity = 0;
      let totalCents = 0;
      const items = input.items.map((item) => {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.productId);
        if (!product || product.stock < item.quantity) throw new HttpError(409, 'Product availability changed. Review your bag and try again.');
        quantity += item.quantity;
        totalCents += product.price_cents * item.quantity;
        return { productId: product.id, title: product.title, quantity: item.quantity, priceCents: product.price_cents };
      });
      if (!Number.isSafeInteger(totalCents) || totalCents !== input.expectedTotalCents) throw new HttpError(409, 'Prices changed. Review the updated total before placing your order.');
      const reference = `DEMO-${randomBytes(10).toString('hex').toUpperCase()}`;
      const createdAt = new Date().toISOString();
      for (const item of items) db.prepare('UPDATE products SET stock = stock - ?, version = version + 1 WHERE id = ?').run(item.quantity, item.productId);
      db.prepare(`INSERT INTO orders (reference, created_at, status, items, quantity, total_cents, checkout_key, owner_session, request_hash)
        VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?)`).run(reference, createdAt, JSON.stringify(items), quantity, totalCents, input.checkoutKey, session.token_hash, fingerprint);
      db.exec('COMMIT');
      return { reference, createdAt, status: 'new', items, quantity, totalCents, mode: 'demo' };
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }

  const server = createServer(async (req, res) => {
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      if (req.headers.host !== origin.host) throw new HttpError(403, 'Use the configured application URL.');
      const url = new URL(req.url, origin);
      const path = url.pathname;
      const method = req.method;
      const session = sessionFor(req);
      const ip = req.socket.remoteAddress || 'unknown';

      if (path.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(method)) {
          if (req.headers.origin !== origin.origin) throw new HttpError(403, 'Request origin is not allowed.');
          if (!session || req.headers['x-csrf-token'] !== session.csrf) throw new HttpError(403, 'Your session expired. Refresh the page and try again.');
        }
        if (path === '/api/session' && method === 'GET') {
          rateLimit(`session:${ip}`, 120, 60000);
          db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
          return json(200, describeSession(session || setSession(res)));
        }
        if (path === '/api/auth/login' && method === 'POST') {
          rateLimit(`login:${ip}`, 10, 15 * 60000);
          if (activeLogins >= 2) throw new HttpError(429, 'Sign-in is busy. Please try again shortly.');
          const body = await readJson(req);
          if (typeof body?.email !== 'string' || body.email.length > 254 || typeof body.password !== 'string' || body.password.length > 128) throw new HttpError(400, 'Invalid sign-in details.');
          const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(body.email.trim().toLowerCase());
          activeLogins++;
          let valid;
          try { valid = await verifyPassword(body.password, admin?.password_hash); }
          finally { activeLogins--; }
          if (!valid) throw new HttpError(401, 'Email or password is incorrect.');
          db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
          return json(200, describeSession(setSession(res, admin.id)));
        }
        if (path === '/api/auth/logout' && method === 'POST') {
          db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
          return json(200, describeSession(setSession(res)));
        }
        if (path === '/api/products' && method === 'GET') {
          return json(200, { products: db.prepare('SELECT * FROM products ORDER BY id').all().map(productFromRow) });
        }
        if (path === '/api/products' && method === 'POST') {
          requireAdmin(session);
          const value = validateProduct(await readJson(req));
          const result = db.prepare('INSERT INTO products (title, category, brand, description, price_cents, stock) VALUES (?, ?, ?, ?, ?, ?)')
            .run(value.title, value.category, value.brand, value.description, value.priceCents, value.stock);
          return json(201, productFromRow(db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid)));
        }
        const productRoute = path.match(/^\/api\/products\/(\d+)$/);
        if (productRoute && ['PUT', 'DELETE'].includes(method)) {
          requireAdmin(session);
          const id = Number(productRoute[1]);
          const body = await readJson(req);
          const previous = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
          if (!previous) throw new HttpError(404, 'Product no longer exists.');
          if (body?.version !== previous.version) throw new HttpError(409, 'This product changed. Reload it before saving or deleting.');
          if (method === 'DELETE') {
            const result = db.prepare('DELETE FROM products WHERE id = ? AND version = ?').run(id, body.version);
            if (!result.changes) throw new HttpError(409, 'Product changed. Please reload.');
            return json(200, { deleted: true });
          }
          const value = validateProduct(body);
          const result = db.prepare(`UPDATE products SET title = ?, category = ?, brand = ?, description = ?, price_cents = ?, stock = ?, version = version + 1 WHERE id = ? AND version = ?`)
            .run(value.title, value.category, value.brand, value.description, value.priceCents, value.stock, id, body.version);
          if (!result.changes) throw new HttpError(409, 'Product changed. Please reload.');
          return json(200, productFromRow(db.prepare('SELECT * FROM products WHERE id = ?').get(id)));
        }
        if (path === '/api/orders' && method === 'POST') {
          rateLimit(`checkout:${ip}`, 30, 60000);
          return json(201, { order: checkout(await readJson(req), session) });
        }
        if (path === '/api/admin/orders' && method === 'GET') {
          requireAdmin(session);
          return json(200, { orders: db.prepare('SELECT * FROM orders ORDER BY id').all().map(orderFromRow) });
        }
        const orderRoute = path.match(/^\/api\/admin\/orders\/(DEMO-[A-F0-9]{20})$/);
        if (orderRoute && method === 'PATCH') {
          requireAdmin(session);
          const body = await readJson(req);
          if (!statuses.has(body?.status)) throw new HttpError(400, 'Invalid order status.');
          const result = db.prepare('UPDATE orders SET status = ? WHERE reference = ?').run(body.status, orderRoute[1]);
          if (!result.changes) throw new HttpError(404, 'Order not found.');
          return json(200, { order: orderFromRow(db.prepare('SELECT * FROM orders WHERE reference = ?').get(orderRoute[1])) });
        }
        throw new HttpError(404, 'API endpoint not found.');
      }

      if (!['GET', 'HEAD'].includes(method)) throw new HttpError(405, 'Method not allowed.');
      const file = path === '/' ? 'index.html' : path.slice(1);
      // Never expose database files, server code, environment files, or repository metadata.
      if (!publicFiles.has(file) && !/^assets\/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp|svg|css)$/.test(file) && !/^js\/[a-zA-Z0-9_-]+\.js$/.test(file)) throw new HttpError(404, 'Not found.');
      let content;
      try { content = await readFile(resolve(root, file)); }
      catch { throw new HttpError(404, 'Not found.'); }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': `${types[extname(file)]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      res.end(method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('Request failed:', error.message);
      if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'The server could not complete this request.' });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('close', () => db.close());
  return { server, db };
}
