const API = 'https://dummyjson.com/products';
const PAGE_SIZE = 10;
const STORE_PAGE_SIZE = 12;
const SHOWCASE_INTERVAL = 5000;
// This catalog lives in the browser. DummyJSON simulates writes, so changes
// disappear when the page is refreshed.
const state = {
  products: [],
  page: 1,
  query: '',
  storeQuery: '',
  storeCategory: '',
  storePage: 1,
  showcaseIndex: 0,
  showcasePaused: false,
  cart: [],
  cartNotice: '',
  lastOrder: null,
  orders: [],
  editingId: null,
  loading: true,
};

// A short helper for finding elements defined in index.html.
const $ = (selector) => document.querySelector(selector);
const list = $('#product-list');
const status = $('#status');
const dialog = $('#product-dialog');
const detailDialog = $('#detail-dialog');
const form = $('#product-form');
const saveButton = $('#save-button');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let toastTimer;

// Wait for the catalog before allowing actions that depend on it.
$('#add-button').disabled = true;
$('#search').disabled = true;
$('#store-search').disabled = true;
$('#store-category').disabled = true;
$('#store-previous').disabled = true;
$('#store-next').disabled = true;

// Escape product data before inserting it into an HTML template.
function escapeHtml(value) {
  const replacements = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(value ?? '').replace(/[&<>"']/g, (character) => replacements[character]);
}

// Show a short confirmation or error without interrupting the user.
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  // Restart the animation if another message is already visible.
  toast.classList.remove('toast-animate');
  void toast.offsetWidth;
  toast.classList.add('toast-animate');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// fetch() does not reject for HTTP errors, so check the response explicitly.
async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}).`);
  }
  return response.json();
}

// Load the complete catalog once; search and pagination use the local copy.
async function loadProducts() {
  state.loading = true;
  status.classList.remove('hidden');
  status.textContent = 'Loading products...';
  try {
    // DummyJSON uses limit=0 to return all products.
    const data = await request(`${API}?limit=0`);
    state.products = data.products.map((product) => ({ ...product, local: false }));
    state.loading = false;
    status.classList.remove('is-loading');
    $('#store-status').classList.remove('is-loading');
    $('#add-button').disabled = false;
    $('#search').disabled = false;
    $('#store-search').disabled = false;
    $('#store-category').disabled = false;
    render();
  } catch (error) {
    state.loading = false;
    status.classList.remove('is-loading');
    $('#store-status').classList.remove('is-loading');
    status.textContent = 'Could not load products. Check your connection and refresh the page.';
    $('#store-status').textContent = 'Could not load products. Check your connection and refresh the page.';
    $('#featured-products').innerHTML = '<p class="rail-message">Products are temporarily unavailable.</p>';
    $('#showcase-stage').innerHTML = '<p class="showcase-message">Products are temporarily unavailable.</p>';
    $('#showcase-caption').textContent = 'Catalog unavailable';
    $('#category-breakdown').textContent = 'Categories are unavailable.';
    $('#store-count').textContent = 'Catalog unavailable';
    $('#store-page-info').textContent = 'Catalog unavailable';
    $('#page-info').textContent = 'Catalog unavailable';
    $('#previous').disabled = true;
    $('#next').disabled = true;
  }
}

// Filter the local catalog, select a page, and redraw the table.
function render(highlightId = null) {
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

// Cart and order data are kept in memory, just like the demo catalog.
function stockAvailable(product) {
  return Math.max(0, Math.floor(Number(product.stock) || 0));
}

function formatMoney(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function addToCart(product) {
  const item = state.cart.find((entry) => entry.id === String(product.id));
  if ((item?.quantity || 0) >= stockAvailable(product)) {
    showToast('No more units are available in this demo.');
    return false;
  }
  if (item) item.quantity++;
  else state.cart.push({ id: String(product.id), quantity: 1 });
  state.cartNotice = '';
  state.lastOrder = null;
  renderCart();
  showToast('Added to your bag.');
  return true;
}

function renderCart() {
  // Reconcile the bag if an admin removes a product or reduces its stock.
  let adjusted = false;
  state.cart = state.cart.flatMap((item) => {
    const product = state.products.find((entry) => String(entry.id) === item.id);
    const available = product ? stockAvailable(product) : 0;
    if (!available) { adjusted = true; return []; }
    if (item.quantity > available) { adjusted = true; return [{ ...item, quantity: available }]; }
    return [item];
  });
  if (adjusted) state.cartNotice = 'Your bag was updated because product availability changed.';

  let quantity = 0;
  let totalCents = 0;
  $('#cart-items').innerHTML = state.cart.map((item) => {
    const product = state.products.find((entry) => String(entry.id) === item.id);
    const priceCents = Math.round((Number(product.price) || 0) * 100);
    quantity += item.quantity;
    totalCents += priceCents * item.quantity;
    const image = product.thumbnail && /^https?:\/\//i.test(product.thumbnail)
      ? `<img src="${escapeHtml(product.thumbnail)}" alt="">` : '<span aria-hidden="true">◇</span>';
    return `<article class="bag-item"><div class="bag-item-image">${image}</div><div><h2>${escapeHtml(product.title)}</h2><p class="bag-item-category">${escapeHtml((product.category || 'Product').replace(/-/g, ' '))}</p><p class="bag-item-price">${formatMoney(priceCents)} each</p><div class="bag-quantity"><button type="button" data-cart-action="decrease" data-cart-id="${escapeHtml(item.id)}" aria-label="Decrease quantity of ${escapeHtml(product.title)}">−</button><span aria-label="Quantity">${item.quantity}</span><button type="button" data-cart-action="increase" data-cart-id="${escapeHtml(item.id)}" aria-label="Increase quantity of ${escapeHtml(product.title)}" ${item.quantity >= stockAvailable(product) ? 'disabled' : ''}>+</button></div></div><div class="bag-item-end"><span>${formatMoney(priceCents * item.quantity)}</span><button type="button" class="bag-remove" data-cart-action="remove" data-cart-id="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(product.title)} from bag">Remove</button></div></article>`;
  }).join('');
  $('#cart-count').textContent = quantity;
  $('#nav-cart').setAttribute('aria-label', `Shopping bag, ${quantity} ${quantity === 1 ? 'item' : 'items'}`);
  $('#summary-quantity').textContent = quantity;
  $('#summary-total').textContent = formatMoney(totalCents);
  $('#cart-empty').classList.toggle('hidden', quantity > 0);
  $('#place-order').disabled = quantity === 0;
  $('#cart-notice').textContent = state.cartNotice;
  $('#cart-notice').classList.toggle('hidden', !state.cartNotice);
  const confirmation = $('#order-confirmation');
  confirmation.classList.toggle('hidden', !state.lastOrder);
  confirmation.innerHTML = state.lastOrder
    ? `<strong>Demo order complete</strong>${state.lastOrder.quantity} ${state.lastOrder.quantity === 1 ? 'item' : 'items'} · ${formatMoney(state.lastOrder.totalCents)}. No payment was taken and no order was sent. Stock changes are only in this tab.`
    : '';
  return adjusted;
}

// Orders keep a snapshot of the items and prices at the time of demo checkout.
function renderOrders() {
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

// The carousel uses real catalog products, with clothing first for the editorial layout.
function showcaseProducts() {
  const clothing = ['tops', 'womens-dresses', 'mens-shirts', 'womens-shoes', 'mens-shoes'];
  return [...state.products].sort((a, b) =>
    Number(clothing.includes(b.category)) - Number(clothing.includes(a.category))
  );
}

function renderShowcase() {
  const products = showcaseProducts();
  const stage = $('#showcase-stage');
  const previous = $('#showcase-prev');
  const next = $('#showcase-next');
  const toggle = $('#showcase-toggle');
  previous.disabled = products.length < 2;
  next.disabled = products.length < 2;
  toggle.disabled = products.length < 2 || reducedMotion.matches;
  toggle.textContent = reducedMotion.matches ? 'Motion reduced' : state.showcasePaused ? 'Play' : 'Pause';

  if (!products.length) {
    stage.innerHTML = '<p class="showcase-message">No products available yet.</p>';
    $('#showcase-caption').textContent = 'The collection is empty';
    return;
  }

  state.showcaseIndex %= products.length;
  const current = products[state.showcaseIndex];
  const imageFor = (product) => product.thumbnail && /^https?:\/\//i.test(product.thumbnail)
    ? `<img src="${escapeHtml(product.thumbnail)}" alt="">`
    : '<span class="showcase-placeholder" aria-hidden="true">◇</span>';
  const before = products[(state.showcaseIndex - 1 + products.length) % products.length];
  const after = products[(state.showcaseIndex + 1) % products.length];
  stage.innerHTML = `
    <div class="showcase-item showcase-side" aria-hidden="true">${products.length > 1 ? imageFor(before) : ''}</div>
    <button type="button" class="showcase-item showcase-main" data-store-id="${escapeHtml(current.id)}" aria-label="View details for ${escapeHtml(current.title)}">${imageFor(current)}</button>
    <div class="showcase-item showcase-side" aria-hidden="true">${products.length > 2 ? imageFor(after) : ''}</div>`;
  const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(current.price) || 0);
  $('#showcase-caption').innerHTML = `<span class="campaign-kicker">${escapeHtml((current.category || 'Featured product').replace(/-/g, ' '))} · ${state.showcaseIndex + 1} / ${products.length}</span><p>${escapeHtml(current.title)}</p><span>${price}</span>`;
}

function advanceShowcase(direction) {
  const count = state.products.length;
  if (count < 2) return;
  state.showcaseIndex = (state.showcaseIndex + direction + count) % count;
  renderShowcase();
}

// Both views use the same in-memory products, but have separate filters and pages.
function renderStore() {
  // Prefer clothing for the editorial rail, while keeping it tied to real catalog data.
  const clothingCategories = ['tops', 'womens-dresses', 'mens-shirts', 'womens-shoes', 'mens-shoes'];
  const featured = [...state.products].sort((a, b) =>
    Number(clothingCategories.includes(b.category)) - Number(clothingCategories.includes(a.category))
  ).slice(0, 2);
  $('#featured-products').innerHTML = featured.length ? featured.map((product) => {
    const image = product.thumbnail && /^https?:\/\//i.test(product.thumbnail)
      ? `<img src="${escapeHtml(product.thumbnail)}" alt="" loading="lazy">`
      : '<span aria-hidden="true">◇</span>';
    const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(product.price) || 0);
    return `<button type="button" class="rail-product" data-store-id="${escapeHtml(product.id)}" aria-label="View details for ${escapeHtml(product.title)}"><span class="rail-image">${image}</span><span class="rail-info"><span>${escapeHtml(product.title)}<span class="rail-price">${price}</span></span><span class="rail-arrow" aria-hidden="true">+</span></span></button>`;
  }).join('') : '<p class="rail-message">No products available yet.</p>';

  const categorySelect = $('#store-category');
  const categories = [...new Set(state.products.map((product) => product.category).filter(Boolean))].sort();
  if (state.storeCategory && !categories.includes(state.storeCategory)) {
    state.storeCategory = '';
  }
  categorySelect.innerHTML = '<option value="">All categories</option>' + categories.map((category) =>
    `<option value="${escapeHtml(category)}">${escapeHtml(category.replace(/-/g, ' '))}</option>`
  ).join('');
  categorySelect.value = state.storeCategory;

  const query = state.storeQuery.trim().toLowerCase();
  const filtered = state.products.filter((product) => {
    const matchesSearch = [product.title, product.category, product.brand].some((value) =>
      String(value || '').toLowerCase().includes(query)
    );
    return matchesSearch && (!state.storeCategory || product.category === state.storeCategory);
  });
  const pages = Math.max(1, Math.ceil(filtered.length / STORE_PAGE_SIZE));
  state.storePage = Math.min(state.storePage, pages);
  const start = (state.storePage - 1) * STORE_PAGE_SIZE;
  const visible = filtered.slice(start, start + STORE_PAGE_SIZE);

  $('#store-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'product' : 'products'} to explore`;
  $('#store-products').innerHTML = visible.map((product) => {
    const image = product.thumbnail && /^https?:\/\//i.test(product.thumbnail)
      ? `<img src="${escapeHtml(product.thumbnail)}" alt="" loading="lazy" class="motion-safe:transition motion-safe:duration-300 motion-safe:group-hover:scale-105">`
      : '<span aria-hidden="true" class="text-5xl text-stone-400">◇</span>';
    const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(product.price) || 0);
    return `
      <article class="store-card group">
        <div class="editorial-card-image grid place-items-center overflow-hidden p-5">${image}</div>
        <div class="pt-4">
          <p class="text-[10px] uppercase tracking-[.15em] text-stone-400">${escapeHtml((product.category || 'Uncategorized').replace(/-/g, ' '))}</p>
          <h3 class="mt-2 text-sm font-semibold text-stone-800">${escapeHtml(product.title)}</h3>
          <div class="mt-3 flex flex-wrap items-center justify-between gap-2"><span class="text-xs text-stone-500">${price}</span><div class="flex gap-3"><button type="button" data-store-id="${escapeHtml(product.id)}" aria-label="View details for ${escapeHtml(product.title)}" class="border-b border-stone-400 pb-1 text-[10px] uppercase tracking-wider text-stone-700 hover:text-black">Details</button><button type="button" data-add-id="${escapeHtml(product.id)}" aria-label="Add ${escapeHtml(product.title)} to bag" ${stockAvailable(product) === 0 ? 'disabled' : ''} class="border-b border-stone-400 pb-1 text-[10px] uppercase tracking-wider text-stone-700 hover:text-black disabled:opacity-40">${stockAvailable(product) === 0 ? 'Sold out' : 'Add to bag'}</button></div></div>
        </div>
      </article>`;
  }).join('');
  const storeStatus = $('#store-status');
  storeStatus.classList.toggle('hidden', filtered.length > 0);
  if (!filtered.length) storeStatus.textContent = 'No products found. Try a different search or category.';
  $('#store-page-info').textContent = filtered.length
    ? `Showing ${start + 1}–${Math.min(start + STORE_PAGE_SIZE, filtered.length)} of ${filtered.length} products`
    : 'Showing 0 products';
  $('#store-previous').disabled = state.storePage <= 1;
  $('#store-next').disabled = state.storePage >= pages;
}

// Hash navigation keeps all views in the same tab and preserves demo changes.
function showCurrentView() {
  const hash = window.location.hash;
  const view = hash === '#admin' ? 'admin' : hash === '#collection' ? 'collection' : hash === '#cart' ? 'cart' : 'store';
  for (const name of ['store', 'collection', 'cart', 'admin']) {
    $(`#${name}-view`).classList.toggle('hidden', name !== view);
  }
  const titles = { store: 'Storefront', collection: 'Collection', cart: 'Shopping bag', admin: 'Admin' };
  document.title = `${titles[view]} | Stockroom`;
  for (const [selector, active] of [
    ['#nav-store', view === 'store'],
    ['#nav-collection', view === 'collection'],
    ['#nav-cart', view === 'cart'],
    ['#nav-admin', view === 'admin'],
  ]) {
    const link = $(selector);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  return view;
}

// Reuse the same form for creating a product and editing an existing one.
function openForm(product) {
  form.reset();
  $('#form-error').classList.add('hidden');
  state.editingId = product ? String(product.id) : null;
  $('#dialog-title').textContent = product ? 'Edit product' : 'Add product';
  saveButton.textContent = product ? 'Save changes' : 'Add product';
  if (product) {
    for (const field of ['title', 'category', 'brand', 'price', 'stock', 'description']) {
      form.elements[field].value = product[field] ?? '';
    }
  }
  dialog.showModal();
}

// Show details from the current catalog, including any session edits.
function openDetails(product, isAdmin = true) {
  $('#detail-title').textContent = product.title;
  $('#detail-description').textContent = product.description || 'No description available.';
  $('#detail-category').textContent = (product.category || 'Product details').replace(/-/g, ' ');
  $('#detail-price').textContent = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Number(product.price) || 0);

  const imageContainer = $('#detail-image');
  const gallery = $('#detail-gallery');
  gallery.replaceChildren();
  // Some products have multiple photos; session-created products may have none.
  const images = [...new Set([product.thumbnail, ...(Array.isArray(product.images) ? product.images : [])]
    .filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url)))];
  const thumbnails = [];

  function showDetailImage(url) {
    imageContainer.replaceChildren();
    if (!url) {
      imageContainer.textContent = '◇';
      return;
    }
    const img = document.createElement('img');
    img.src = url;
    img.alt = product.title;
    img.onerror = () => {
      // Ignore errors from an image that is no longer selected.
      if (img.parentNode === imageContainer) {
        const message = document.createElement('span');
        message.className = 'detail-image-message';
        message.textContent = 'Image unavailable';
        imageContainer.replaceChildren(message);
      }
    };
    imageContainer.append(img);
    thumbnails.forEach((button, index) => button.setAttribute('aria-pressed', String(images[index] === url)));
  }

  if (images.length > 1) {
    images.forEach((url, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'detail-thumbnail';
      button.setAttribute('aria-label', `Show product image ${index + 1}`);
      const thumbnail = document.createElement('img');
      thumbnail.src = url;
      thumbnail.alt = '';
      button.append(thumbnail);
      button.addEventListener('click', () => showDetailImage(url));
      thumbnails.push(button);
      gallery.append(button);
    });
  }
  showDetailImage(images[0]);

  const fields = [
    ['Brand', product.brand || 'Not specified'],
    ['Stock', `${Number(product.stock) || 0} items`],
    ['SKU', product.sku || 'Not available'],
    ['Rating', product.rating == null ? 'Not available' : `${product.rating} / 5`],
  ];
  $('#detail-fields').innerHTML = fields.map(([label, value]) => `
    <div>
      <dt class="text-xs font-bold uppercase tracking-wider text-slate-400">${escapeHtml(label)}</dt>
      <dd class="mt-1.5 break-words text-sm font-semibold text-slate-700">${escapeHtml(value)}</dd>
    </div>`).join('');
  $('#edit-detail').classList.toggle('hidden', !isAdmin);
  $('#add-to-bag').classList.toggle('hidden', isAdmin);
  $('#add-to-bag').disabled = stockAvailable(product) === 0;
  $('#add-to-bag').textContent = stockAvailable(product) === 0 ? 'Sold out' : 'Add to bag →';
  $('#add-to-bag').onclick = () => {
    if (addToCart(product)) detailDialog.close();
  };
  $('#edit-detail').onclick = () => {
    detailDialog.close();
    openForm(product);
  };
  detailDialog.showModal();
}

// Connect the page controls to their actions.
window.addEventListener('hashchange', () => {
  const view = showCurrentView();
  window.scrollTo(0, 0);
  $(`#${view}-view`).focus({ preventScroll: true });
});
$('#showcase-prev').addEventListener('click', () => advanceShowcase(-1));
$('#showcase-next').addEventListener('click', () => advanceShowcase(1));
$('#showcase-toggle').addEventListener('click', () => {
  state.showcasePaused = !state.showcasePaused;
  renderShowcase();
});
reducedMotion.addEventListener('change', renderShowcase);
$('#store-search').addEventListener('input', (event) => {
  state.storeQuery = event.target.value;
  state.storePage = 1;
  renderStore();
});
$('#store-category').addEventListener('change', (event) => {
  state.storeCategory = event.target.value;
  state.storePage = 1;
  renderStore();
});
$('#store-previous').addEventListener('click', () => {
  state.storePage--;
  renderStore();
});
$('#store-next').addEventListener('click', () => {
  state.storePage++;
  renderStore();
});
function handleStoreProductClick(event) {
  const addButton = event.target.closest('button[data-add-id]');
  if (addButton) {
    const product = state.products.find((item) => String(item.id) === addButton.dataset.addId);
    if (product) addToCart(product);
    return;
  }
  const button = event.target.closest('button[data-store-id]');
  if (!button) return;
  const product = state.products.find((item) => String(item.id) === button.dataset.storeId);
  if (product) openDetails(product, false);
}
$('#store-products').addEventListener('click', handleStoreProductClick);
$('#featured-products').addEventListener('click', handleStoreProductClick);
$('#showcase-stage').addEventListener('click', handleStoreProductClick);
$('#cart-items').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-cart-action]');
  if (!button) return;
  const item = state.cart.find((entry) => entry.id === button.dataset.cartId);
  const product = state.products.find((entry) => String(entry.id) === button.dataset.cartId);
  if (!item || !product) return;
  if (button.dataset.cartAction === 'increase' && item.quantity < stockAvailable(product)) item.quantity++;
  if (button.dataset.cartAction === 'decrease') item.quantity--;
  if (button.dataset.cartAction === 'remove' || item.quantity <= 0) {
    state.cart = state.cart.filter((entry) => entry !== item);
  }
  state.cartNotice = '';
  renderCart();
});
$('#place-order').addEventListener('click', () => {
  // If stock changed, let the shopper review the adjusted bag before ordering.
  if (renderCart()) return;
  if (!state.cart.length) return;
  const order = {
    reference: `DEMO-${String(state.orders.length + 1).padStart(4, '0')}`,
    createdAt: new Date().toISOString(),
    status: 'new',
    items: [],
    quantity: 0,
    totalCents: 0,
  };
  for (const item of state.cart) {
    const product = state.products.find((entry) => String(entry.id) === item.id);
    const priceCents = Math.round((Number(product.price) || 0) * 100);
    order.items.push({ title: product.title, quantity: item.quantity, priceCents });
    order.quantity += item.quantity;
    order.totalCents += priceCents * item.quantity;
    product.stock = stockAvailable(product) - item.quantity;
  }
  state.orders.push(order);
  state.cart = [];
  state.cartNotice = '';
  state.lastOrder = order;
  render();
  renderOrders();
});
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
$('#orders-list').addEventListener('change', (event) => {
  const select = event.target.closest('select[data-order-id]');
  if (!select || !['new', 'processing', 'completed'].includes(select.value)) return;
  const order = state.orders.find((entry) => entry.reference === select.dataset.orderId);
  if (!order) return;
  order.status = select.value;
  showToast('Demo order status updated.');
});
$('#add-button').addEventListener('click', () => openForm());
$('#close-detail').addEventListener('click', () => detailDialog.close());
$('#dismiss-detail').addEventListener('click', () => detailDialog.close());
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

// Validate the form, simulate a write, then update the in-memory catalog.
form.addEventListener('submit', async (event) => {
  event.preventDefault();
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
  const existing = state.products.find((product) => String(product.id) === state.editingId);
  let highlightId = null;
  saveButton.disabled = true;
  $('#form-error').classList.add('hidden');
  try {
    if (existing) {
      // Products created in this session do not exist on the API server.
      if (!existing.local) {
        await request(`${API}/${existing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        });
      }
      Object.assign(existing, values);
    } else {
      await request(`${API}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      // Use a unique local ID because the API does not persist new products.
      state.products.unshift({
        ...values,
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        local: true,
      });
      highlightId = state.products[0].id;
      state.query = '';
      $('#search').value = '';
      state.page = 1;
    }
    dialog.close();
    render(highlightId);
    showToast(existing ? 'Product updated for this session.' : 'Product added for this session.');
  } catch (error) {
    $('#form-error').textContent = 'Could not save the product. Please check your connection and try again.';
    $('#form-error').classList.remove('hidden');
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
  if (!confirm(`Delete “${product.title}” from this session?`)) return;
  button.disabled = true;
  try {
    // Session-created products only need to be removed from local state.
    if (!product.local) {
      await request(`${API}/${product.id}`, { method: 'DELETE' });
    }
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
    showToast('Product deleted for this session.');
  } catch (error) {
    button.disabled = false;
    showToast('Could not delete the product. Please try again.');
  }
});

// Start the app when the script loads.
showCurrentView();
loadProducts();
// Stop moving while the user is interacting, viewing a dialog, or on another tab.
setInterval(() => {
  const showcase = $('#showcase');
  if (state.loading || state.showcasePaused || reducedMotion.matches || document.hidden ||
      ['#admin', '#collection', '#cart'].includes(window.location.hash) || dialog.open || detailDialog.open ||
      showcase.matches(':hover') || showcase.contains(document.activeElement)) return;
  advanceShowcase(1);
}, SHOWCASE_INTERVAL);
