import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceTextModule } from 'node:vm';
import { request as httpRequest } from 'node:http';
import { JSDOM } from 'jsdom';
import { createApplication } from '../server/app.mjs';
import { createAdmin } from '../server/auth.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test('storefront and dashboard use the persistent API end to end', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'stockroom-ui-'));
  const { server, db } = createApplication({ databasePath: join(directory, 'test.sqlite') });
  await createAdmin(db, 'admin@example.test', 'test-password-for-stockroom');
  db.prepare('INSERT INTO products (title, category, price_cents, stock) VALUES (?, ?, ?, ?)').run('Canvas bag', 'accessories', 1995, 8);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  let page;
  let loseNextOrderResponse = false;
  t.after(async () => {
    page?.window.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  async function openPage(hash = '#store', storage = null) {
    page?.window.close();
    page = new JSDOM(html, { url: `http://localhost:3000/${hash}`, runScripts: 'outside-only' });
    const { window } = page;
    window.Headers = Headers;
    window.matchMedia = () => Object.assign(new window.EventTarget(), { matches: true });
    window.ResizeObserver = class { observe() {} disconnect() {} };
    window.scrollTo = () => {};
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    window.confirm = () => true;
    if (storage) window.sessionStorage.setItem('stockroom-bag-v1', storage);
    // Use real HTTP, supplying a cookie jar because jsdom does not implement fetch.
    window.fetch = (path, options = {}) => new Promise((resolve, reject) => {
      const headers = { ...Object.fromEntries(new Headers(options.headers)), Host: 'localhost:3000', Origin: 'http://localhost:3000', Cookie: cookie };
      if (options.body) headers['Content-Length'] = Buffer.byteLength(options.body);
      const request = httpRequest(`${baseUrl}${path}`, { method: options.method || 'GET', headers }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          if (response.headers['set-cookie']) cookie = response.headers['set-cookie'][0].split(';')[0];
          if (path === '/api/orders' && loseNextOrderResponse) {
            loseNextOrderResponse = false;
            reject(new Error('Simulated connection loss after the server committed.'));
          } else {
            resolve({ ok: response.statusCode < 400, status: response.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')) });
          }
        });
      });
      request.on('error', reject);
      request.end(options.body);
    });
    // Evaluate the actual module graph, including circular UI imports, in an isolated DOM.
    const context = page.getInternalVMContext();
    const modules = new Map();
    function moduleFor(url) {
      const name = url.href;
      if (!modules.has(name)) modules.set(name, new SourceTextModule(readFileSync(url, 'utf8'), { context, identifier: name }));
      return modules.get(name);
    }
    const main = moduleFor(new URL('../js/main.js', import.meta.url));
    await main.link((specifier, referrer) => moduleFor(new URL(specifier, referrer.identifier)));
    await main.evaluate();
    await waitFor(() => window.document.querySelectorAll('#store-products article').length > 0, 'Catalog did not render.');
    return (selector) => window.document.querySelector(selector);
  }
  let $ = await openPage('#admin');
  const submit = (selector) => $(selector).dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));

  await t.test('guest sees sign-in and can shop after refresh', async () => {
    assert.equal($('#login-view').classList.contains('hidden'), false);
    assert.equal($('#admin-view').classList.contains('hidden'), true);
    $('#nav-collection').click();
    $('#store-products [data-add-id="1"]').click();
    assert.equal($('#cart-count').textContent, '1');
    const storage = page.window.sessionStorage.getItem('stockroom-bag-v1');
    $ = await openPage('#cart', storage);
    assert.equal($('#summary-total').textContent, '$19.95');
    $('#place-order').click();
    await waitFor(() => $('#order-confirmation').textContent.includes('Demo order saved'), 'Order confirmation was not displayed.');
    assert.equal(db.prepare('SELECT stock FROM products WHERE id = 1').get().stock, 7);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 1);
  });

  await t.test('lost checkout response can be retried after refresh without double ordering', async () => {
    $('#nav-collection').click();
    $('#store-products [data-add-id="1"]').click();
    $('#nav-cart').click();
    loseNextOrderResponse = true;
    $('#place-order').click();
    await waitFor(() => $('#place-order').textContent === 'Check pending order', 'Pending checkout was not recoverable.');
    const storage = page.window.sessionStorage.getItem('stockroom-bag-v1');
    $ = await openPage('#cart', storage);
    assert.equal($('#place-order').textContent, 'Check pending order');
    $('#place-order').click();
    await waitFor(() => $('#order-confirmation').textContent.includes('Demo order saved'), 'Retried order did not complete.');
    assert.equal(db.prepare('SELECT stock FROM products WHERE id = 1').get().stock, 6);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 2);
  });

  await t.test('admin sign-in, product CRUD, saved order status, and sign-out', async () => {
    $('#nav-admin').click();
    $('#login-form').elements.email.value = 'admin@example.test';
    $('#login-form').elements.password.value = 'test-password-for-stockroom';
    submit('#login-form');
    await waitFor(() => $('#orders-list').querySelectorAll('.order-card').length === 2, 'Admin orders did not load after login.');
    assert.equal($('#admin-view').classList.contains('hidden'), false);
    $('#add-button').click();
    const form = $('#product-form');
    for (const [name, value] of Object.entries({ title: 'New notebook', category: 'stationery', brand: 'Studio', price: '5.50', stock: '4', description: 'Paper notebook' })) form.elements[name].value = value;
    submit('#product-form');
    await waitFor(() => !$('#product-dialog').open, 'Product create did not finish.');
    const created = db.prepare('SELECT * FROM products WHERE title = ?').get('New notebook');
    assert.ok(created);
    $(`#product-list [data-action="edit"][data-id="${created.id}"]`).click();
    form.elements.price.value = '6.25';
    submit('#product-form');
    await waitFor(() => !$('#product-dialog').open, 'Product edit did not finish.');
    assert.equal(db.prepare('SELECT price_cents FROM products WHERE id = ?').get(created.id).price_cents, 625);
    $(`#product-list [data-action="delete"][data-id="${created.id}"]`).click();
    await waitFor(() => !db.prepare('SELECT id FROM products WHERE id = ?').get(created.id), 'Product delete did not persist.');
    const select = $('#orders-list select');
    select.value = 'processing';
    select.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    await waitFor(() => db.prepare('SELECT status FROM orders WHERE reference = ?').get(select.dataset.orderId).status === 'processing', 'Order status was not saved.');
    await waitFor(() => !select.disabled, 'Order status request did not settle.');
    $('#logout-button').click();
    await waitFor(() => !$('#login-view').classList.contains('hidden'), 'Sign-out did not return to login.');
    assert.equal($('#orders-list').querySelectorAll('.order-card').length, 0);
    $ = await openPage('#admin');
    assert.equal($('#admin-view').classList.contains('hidden'), true);
  });
});
