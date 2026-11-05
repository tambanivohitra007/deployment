import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createApplication } from '../server/app.mjs';
import { createAdmin } from '../server/auth.mjs';

// Real HTTP requests against an isolated, temporary database; never the user's catalog.
test('persistent catalog, protected administration, and atomic demo checkout', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'stockroom-test-'));
  const databasePath = join(directory, 'test.sqlite');
  const origin = 'http://localhost:3000';
  let application;
  let baseUrl;
  async function start() {
    application = createApplication({ databasePath, origin });
    await new Promise((resolve) => application.server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${application.server.address().port}`;
  }
  async function stop() {
    await new Promise((resolve, reject) => application.server.close((error) => error ? reject(error) : resolve()));
  }
  await start();
  t.after(async () => {
    if (application.server.listening) await stop();
    await rm(directory, { recursive: true, force: true });
  });
  await createAdmin(application.db, 'admin@example.test', 'test-password-for-stockroom');

  function client() {
    return {
      cookie: '', csrf: '',
      async call(path, method = 'GET', body, extraHeaders = {}) {
        const headers = { Host: 'localhost:3000', Origin: origin, Cookie: this.cookie, 'X-CSRF-Token': this.csrf, ...extraHeaders };
        if (body !== undefined) {
          headers['Content-Type'] = 'application/json';
          headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
        }
        // Explicit Host lets each isolated test server use a random free port.
        const response = await new Promise((resolve, reject) => {
          const request = httpRequest(`${baseUrl}${path}`, { method, headers }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
          });
          request.on('error', reject);
          request.end(body === undefined ? undefined : JSON.stringify(body));
        });
        const responseHeaders = { get: (name) => Array.isArray(response.headers[name]) ? response.headers[name][0] : response.headers[name] };
        const cookie = responseHeaders.get('set-cookie');
        if (cookie) this.cookie = cookie.split(';')[0];
        const type = responseHeaders.get('content-type');
        const data = type?.includes('application/json') ? JSON.parse(response.text) : response.text;
        if (data.csrfToken) this.csrf = data.csrfToken;
        return { status: response.status, data, headers: responseHeaders };
      },
    };
  }
  const guest = client();
  const admin = client();
  const product = { title: 'Canvas bag', category: 'accessories', brand: 'Stockroom', description: 'A durable bag.', price: 19.95, stock: 5 };
  let saved;
  let order;

  await t.test('sessions, CSRF, sign-in, and static-file boundaries', async () => {
    const session = await guest.call('/api/session');
    assert.equal(session.data.admin, null);
    assert.match(session.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.equal((await guest.call('/api/admin/orders')).status, 401);
    assert.equal((await guest.call('/api/products', 'POST', product)).status, 401);
    assert.equal((await guest.call('/api/products', 'POST', product, { Origin: 'https://other.example' })).status, 403);
    assert.equal((await guest.call('/api/orders', 'POST', {}, { 'X-CSRF-Token': '' })).status, 403);
    for (const path of ['/server/auth.mjs', '/data/stockroom.sqlite', '/.env', '/.git/config']) {
      assert.equal((await guest.call(path)).status, 404);
    }
    assert.equal((await guest.call('/js/main.js')).status, 200);
    await admin.call('/api/session');
    const oldCookie = admin.cookie;
    assert.equal((await admin.call('/api/auth/login', 'POST', { email: 'admin@example.test', password: 'incorrect' })).status, 401);
    const login = await admin.call('/api/auth/login', 'POST', { email: 'admin@example.test', password: 'test-password-for-stockroom' });
    assert.equal(login.status, 200);
    assert.equal(login.data.admin.email, 'admin@example.test');
    assert.notEqual(admin.cookie, oldCookie);
    assert.equal(application.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 2);
  });

  await t.test('validated CRUD and stale-edit protection', async () => {
    assert.equal((await admin.call('/api/products', 'POST', { ...product, stock: -1 })).status, 400);
    assert.equal((await admin.call('/api/products', 'POST', { ...product, price: 1.234 })).status, 400);
    const created = await admin.call('/api/products', 'POST', product);
    assert.equal(created.status, 201);
    saved = created.data;
    assert.equal(saved.version, 1);
    const updated = await admin.call(`/api/products/${saved.id}`, 'PUT', { ...saved, title: 'Everyday canvas bag' });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.version, 2);
    assert.equal((await admin.call(`/api/products/${saved.id}`, 'PUT', saved)).status, 409);
    assert.equal((await admin.call(`/api/products/${saved.id}`, 'DELETE', { version: 1 })).status, 409);
    saved = updated.data;
  });

  await t.test('server totals, atomic failures, and checkout retry idempotency', async () => {
    const payload = { items: [{ productId: saved.id, quantity: 2 }], expectedTotalCents: 3990, checkoutKey: randomUUID() };
    assert.equal((await guest.call('/api/orders', 'POST', { ...payload, expectedTotalCents: 1 })).status, 409);
    assert.equal((await guest.call('/api/orders', 'POST', { ...payload, items: [...payload.items, { productId: 9999, quantity: 1 }] })).status, 409);
    assert.equal((await guest.call('/api/products')).data.products[0].stock, 5);
    const purchased = await guest.call('/api/orders', 'POST', payload);
    assert.equal(purchased.status, 201);
    order = purchased.data.order;
    assert.equal(order.totalCents, 3990);
    assert.equal(order.mode, 'demo');
    const retry = await guest.call('/api/orders', 'POST', payload);
    assert.equal(retry.data.order.reference, order.reference);
    assert.equal((await guest.call('/api/products')).data.products[0].stock, 3);
    assert.equal((await admin.call('/api/orders', 'POST', payload)).status, 409);
    assert.equal((await admin.call(`/api/products/${saved.id}`, 'PUT', saved)).status, 409);
    const orders = await admin.call('/api/admin/orders');
    assert.equal(orders.data.orders.length, 1);
  });

  await t.test('competing checkouts cannot oversell', async () => {
    const requests = Array.from({ length: 2 }, () => guest.call('/api/orders', 'POST', {
      items: [{ productId: saved.id, quantity: 2 }], expectedTotalCents: 3990, checkoutKey: randomUUID(),
    }));
    const responses = await Promise.all(requests);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    assert.equal((await guest.call('/api/products')).data.products[0].stock, 1);
  });

  await t.test('orders, product changes, and sessions survive restart', async () => {
    assert.equal((await admin.call(`/api/admin/orders/${order.reference}`, 'PATCH', { status: 'paid' })).status, 400);
    assert.equal((await admin.call(`/api/admin/orders/${order.reference}`, 'PATCH', { status: 'processing' })).status, 200);
    await stop();
    await start();
    assert.equal((await admin.call('/api/session')).data.admin.email, 'admin@example.test');
    const current = (await admin.call('/api/products')).data.products[0];
    assert.equal(current.stock, 1);
    assert.equal((await admin.call(`/api/products/${current.id}`, 'DELETE', { version: current.version })).status, 200);
    const persisted = (await admin.call('/api/admin/orders')).data.orders;
    assert.equal(persisted.length, 2);
    assert.equal(persisted[0].status, 'processing');
    assert.equal(persisted[0].items[0].title, 'Everyday canvas bag');
    const authenticatedCookie = admin.cookie;
    assert.equal((await admin.call('/api/auth/logout', 'POST', {})).status, 200);
    assert.equal((await admin.call('/api/admin/orders')).status, 401);
    assert.equal((await admin.call('/api/admin/orders', 'GET', undefined, { Cookie: authenticatedCookie })).status, 401);
    await stop();
    await start();
    assert.equal((await guest.call('/api/products')).data.products.length, 0);
  });
});
