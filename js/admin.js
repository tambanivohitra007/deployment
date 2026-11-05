import { state, API, PAGE_SIZE } from './state.js';
import { $, escapeHtml, showToast, request, formatMoney, reducedMotion } from './utils.js';
import { renderStore, renderShowcase, openDetails } from './store.js';
import { renderCart } from './cart.js';
import { loadCatalog } from './data.js';

export const list = $('#product-list');
export const status = $('#status');
export const dialog = $('#product-dialog');
const form = $('#product-form');
const saveButton = $('#save-button');

// Filter the local catalog, select a page, and redraw the table.
export function render(highlightId = null) {
  renderAdminSummary();
  const query = state.query.trim().toLowerCase();
  const filtered = state.products.filter((product) =>
    [product.title, product.category, product.brand].some((value) =>
      String(value || '').toLowerCase().includes(query)
    )
  );

  // Keep the current page within bounds after a search or deletion.
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  $('#count').textContent = filtered.length;

  list.innerHTML = visible.map((product) => {
    const stock = Number(product.stock) || 0;
    let stockClass = 'bg-emerald-50 text-emerald-700';
    if (stock === 0) {
      stockClass = 'bg-red-50 text-red-700';
    } else if (stock < 10) {
      stockClass = 'bg-amber-50 text-amber-700';
    }
    const image = product.thumbnail && /^https?:\/\//i.test(product.thumbnail)
      ? `<img src="${escapeHtml(product.thumbnail)}" alt="" class="h-12 w-12 rounded-lg bg-slate-50 object-contain" loading="lazy">`
      : '<span class="grid h-12 w-12 place-items-center rounded-lg bg-emerald-50 text-lg font-bold text-emerald-700" aria-hidden="true">◇</span>';

    // Product values must be escaped because the rows are inserted as HTML.
    return `
      <tr class="product-row ${product.id === highlightId ? 'product-new' : ''} transition hover:bg-slate-50/70">
        <td class="px-5 py-3">
          <div class="flex items-center gap-3">
            ${image}
            <div>
              <div class="font-bold text-slate-800">${escapeHtml(product.title)}</div>
              <div class="mt-1 text-xs text-slate-400">${escapeHtml(product.brand || 'No brand')}</div>
            </div>
          </div>
        </td>
        <td class="px-5 py-3 capitalize text-slate-500">${escapeHtml((product.category || 'Uncategorized').replace(/-/g, ' '))}</td>
        <td class="px-5 py-3 font-semibold text-slate-700">${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(product.price) || 0)}</td>
        <td class="px-5 py-3">
          <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${stockClass}">${stock} ${stock === 1 ? 'item' : 'items'}</span>
        </td>
        <td class="whitespace-nowrap px-5 py-3 text-right">
          <button type="button" data-action="view" data-id="${escapeHtml(product.id)}" class="rounded-lg px-2 py-2 font-semibold text-slate-600 hover:bg-slate-100" aria-label="View details for ${escapeHtml(product.title)}">View</button>
          <button type="button" data-action="edit" data-id="${escapeHtml(product.id)}" class="rounded-lg px-2 py-2 font-semibold text-emerald-700 hover:bg-emerald-50" aria-label="Edit ${escapeHtml(product.title)}">Edit</button>
          <button type="button" data-action="delete" data-id="${escapeHtml(product.id)}" class="rounded-lg px-2 py-2 font-semibold text-slate-400 hover:bg-red-50 hover:text-red-700" aria-label="Delete ${escapeHtml(product.title)}">Delete</button>
        </td>
      </tr>`;
  }).join('');

  status.classList.toggle('hidden', filtered.length > 0);
  if (!filtered.length) {
    status.textContent = query
      ? 'No products match your search.'
      : 'No products yet. Add one to get started.';
  }
  $('#page-info').textContent = filtered.length
    ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length} products`
    : 'Showing 0 products';
  $('#previous').disabled = state.page <= 1;
  $('#next').disabled = state.page >= pages;
  renderStore();
  renderShowcase();
  renderCart();
}

// Orders keep a snapshot of the items and prices at the time of demo checkout.
export function renderOrders() {
  const orders = state.orders;
  $('#orders-count').textContent = orders.length;
  const list = $('#orders-list');
  if (!orders.length) {
    list.innerHTML = '<p class="orders-empty">No demo orders yet. Orders placed in the storefront will appear here.</p>';
    return;
  }
  const statuses = [['new', 'New'], ['processing', 'Processing'], ['completed', 'Completed']];
  list.innerHTML = [...orders].reverse().map((order) => {
    const date = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(order.createdAt));
    const options = statuses.map(([value, label]) =>
      `<option value="${value}" ${order.status === value ? 'selected' : ''}>${label}</option>`
    ).join('');
    const items = order.items.map((item) => `
      <div class="order-item"><span>${escapeHtml(item.title)} × ${item.quantity}</span><span>${formatMoney(item.priceCents * item.quantity)}</span></div>`
    ).join('');
    return `
      <article class="order-card">
        <div><div class="order-card-heading"><strong>${escapeHtml(order.reference)}</strong><time datetime="${escapeHtml(order.createdAt)}">${escapeHtml(date)}</time></div><p class="order-card-meta">${order.quantity} ${order.quantity === 1 ? 'item' : 'items'} · Demo order</p></div>
        <div><p class="order-card-total">${formatMoney(order.totalCents)}</p><select class="order-status" data-order-id="${escapeHtml(order.reference)}" aria-label="Status for ${escapeHtml(order.reference)}">${options}</select></div>
        <details class="order-details"><summary>View items</summary>${items}</details>
      </article>`;
  }).join('');
}

// The dashboard summarizes the full catalog, regardless of table search or page.
function renderAdminSummary() {
  const products = state.products;
  const totalUnits = products.reduce((total, product) => total + (Number(product.stock) || 0), 0);
  const lowStock = products.filter((product) => (Number(product.stock) || 0) < 10).length;
  const retailValue = products.reduce((total, product) =>
    total + (Number(product.price) || 0) * (Number(product.stock) || 0), 0
  );
  $('#metric-products').textContent = new Intl.NumberFormat('en-US').format(products.length);
  $('#metric-units').textContent = new Intl.NumberFormat('en-US').format(totalUnits);
  $('#metric-low').textContent = new Intl.NumberFormat('en-US').format(lowStock);
  $('#metric-value').textContent = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(retailValue);

  const counts = new Map();
  for (const product of products) {
    const category = product.category || 'Uncategorized';
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  const categories = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
  const breakdown = $('#category-breakdown');
  if (!categories.length) {
    breakdown.textContent = 'No products to summarize yet.';
    return;
  }
  const maxCount = categories[0][1];
  breakdown.innerHTML = categories.map(([category, count]) => `
    <div class="category-row">
      <span class="category-name">${escapeHtml(category.replace(/-/g, ' '))}</span>
      <span class="category-bar" aria-hidden="true"><span class="category-fill" style="width: ${count / maxCount * 100}%"></span></span>
      <span class="category-count" aria-label="${count} ${count === 1 ? 'product' : 'products'}">${count}</span>
    </div>`).join('');
}

// Reuse the same form for creating a product and editing an existing one.
export function openForm(product) {
  if (!state.admin) return;
  form.reset();
  $('#form-error').classList.add('hidden');
  state.editingId = product ? String(product.id) : null;
  // Capture the version when the form opens, so background refreshes cannot mask a conflict.
  state.editingVersion = product?.version ?? null;
  $('#dialog-title').textContent = product ? 'Edit product' : 'Add product';
  saveButton.textContent = product ? 'Save changes' : 'Add product';
  if (product) {
    for (const field of ['title', 'category', 'brand', 'price', 'stock', 'description']) {
      form.elements[field].value = product[field] ?? '';
    }
  }
  dialog.showModal();
}

$('#inventory-link').addEventListener('click', () => {
  const inventory = $('#inventory-section');
  inventory.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
  inventory.focus({ preventScroll: true });
});
$('#orders-link').addEventListener('click', () => {
  const orders = $('#orders-section');
  orders.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
  orders.focus({ preventScroll: true });
});
$('#orders-list').addEventListener('change', async (event) => {
  const select = event.target.closest('select[data-order-id]');
  if (!select || !['new', 'processing', 'completed'].includes(select.value)) return;
  const order = state.orders.find((entry) => entry.reference === select.dataset.orderId);
  if (!order) return;
  select.disabled = true;
  try {
    const data = await request(`/api/admin/orders/${order.reference}`, {
      method: 'PATCH', body: JSON.stringify({ status: select.value }),
    });
    Object.assign(order, data.order);
    showToast('Order status saved.');
  } catch (error) {
    select.value = order.status;
    showToast(error.message);
  } finally {
    select.disabled = false;
  }
});
$('#add-button').addEventListener('click', () => openForm());
$('#close-dialog').addEventListener('click', () => dialog.close());
$('#cancel-dialog').addEventListener('click', () => dialog.close());
$('#search').addEventListener('input', (event) => {
  state.query = event.target.value;
  state.page = 1;
  if (!state.loading) {
    render();
  }
});
$('#previous').addEventListener('click', () => {
  state.page--;
  render();
});
$('#next').addEventListener('click', () => {
  state.page++;
  render();
});

// Save on the server first, then display the product returned by the database.
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saveButton.disabled) return;
  const values = Object.fromEntries(new FormData(form));
  for (const field of ['title', 'category', 'brand', 'description']) {
    values[field] = values[field].trim();
  }
  if (!values.title || !values.category) {
    $('#form-error').textContent = 'Product name and category cannot be blank.';
    $('#form-error').classList.remove('hidden');
    return;
  }
  values.price = Number(values.price);
  values.stock = Number(values.stock);
  const editingId = state.editingId;
  const existing = editingId !== null;
  let highlightId = null;
  saveButton.disabled = true;
  $('#form-error').classList.add('hidden');
  try {
    if (existing) {
      const saved = await request(`${API}/${editingId}`, {
        method: 'PUT', body: JSON.stringify({ ...values, version: state.editingVersion }),
      });
      state.products = state.products.map((product) => String(product.id) === editingId ? saved : product);
      highlightId = saved.id;
    } else {
      const saved = await request(API, { method: 'POST', body: JSON.stringify(values) });
      state.products.unshift(saved);
      highlightId = state.products[0].id;
      state.query = '';
      $('#search').value = '';
      state.page = 1;
    }
    dialog.close();
    render(highlightId);
    showToast(existing ? 'Product changes saved.' : 'Product added.');
  } catch (error) {
    $('#form-error').textContent = error.message;
    $('#form-error').classList.remove('hidden');
    if (error.status === 409 || error.status === 404) {
      await loadCatalog().then(() => render()).catch(() => {});
    }
  } finally {
    saveButton.disabled = false;
  }
});

// One listener handles buttons for every row, even after the table is redrawn.
list.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const product = state.products.find((item) => String(item.id) === button.dataset.id);
  if (!product) return;
  if (button.dataset.action === 'view') return openDetails(product);
  if (button.dataset.action === 'edit') return openForm(product);
  if (!confirm(`Permanently delete “${product.title}” from the catalog? Existing orders will keep their item details.`)) return;
  button.disabled = true;
  try {
    await request(`${API}/${product.id}`, { method: 'DELETE', body: JSON.stringify({ version: product.version }) });
    state.products = state.products.filter((item) => item !== product);
    // Fade the deleted row only after the API request succeeds.
    const row = button.closest('tr');
    if (row && row.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const animation = row.animate(
        [{ opacity: 1 }, { opacity: 0, transform: 'translateX(8px)' }],
        { duration: 180, easing: 'ease-in', fill: 'forwards' }
      );
      // A search or page change can remove the row before the animation ends.
      await animation.finished.catch(() => {});
    }
    render();
    showToast('Product deleted.');
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
    if (error.status === 409 || error.status === 404) await loadCatalog().then(() => render()).catch(() => {});
  }
});
