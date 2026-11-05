const API = 'https://dummyjson.com/products';
const PAGE_SIZE = 10;
const state = { products: [], page: 1, query: '', editingId: null, loading: true };
const $ = (selector) => document.querySelector(selector);
const list = $('#product-list');
const status = $('#status');
const dialog = $('#product-dialog');
const detailDialog = $('#detail-dialog');
const form = $('#product-form');
const saveButton = $('#save-button');
let toastTimer;
$('#add-button').disabled = true;
$('#search').disabled = true;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Request failed (${response.status}).`);
  return response.json();
}

async function loadProducts() {
  state.loading = true;
  status.classList.remove('hidden');
  status.textContent = 'Loading products...';
  try {
    const data = await request(`${API}?limit=0`);
    state.products = data.products.map((product) => ({ ...product, local: false }));
    state.loading = false;
    $('#add-button').disabled = false;
    $('#search').disabled = false;
    render();
  } catch (error) {
    state.loading = false;
    status.textContent = 'Could not load products. Check your connection and refresh the page.';
    $('#page-info').textContent = 'Catalog unavailable';
    $('#previous').disabled = true;
    $('#next').disabled = true;
  }
}

function render() {
  const query = state.query.trim().toLowerCase();
  const filtered = state.products.filter((product) => [product.title, product.category, product.brand].some((value) => String(value || '').toLowerCase().includes(query)));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  $('#count').textContent = filtered.length;
  list.innerHTML = visible.map((product) => {
    const stock = Number(product.stock) || 0;
    const stockClass = stock === 0 ? 'bg-red-50 text-red-700' : stock < 10 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700';
    const image = product.thumbnail && /^https?:\/\//i.test(product.thumbnail) ? `<img src="${escapeHtml(product.thumbnail)}" alt="" class="h-12 w-12 rounded-lg bg-slate-50 object-contain" loading="lazy">` : '<span class="grid h-12 w-12 place-items-center rounded-lg bg-emerald-50 text-lg font-bold text-emerald-700" aria-hidden="true">◇</span>';
    return `<tr class="transition hover:bg-slate-50/70"><td class="px-5 py-3"><div class="flex items-center gap-3">${image}<div><div class="font-bold text-slate-800">${escapeHtml(product.title)}</div><div class="mt-1 text-xs text-slate-400">${escapeHtml(product.brand || 'No brand')}</div></div></div></td><td class="px-5 py-3 capitalize text-slate-500">${escapeHtml((product.category || 'Uncategorized').replace(/-/g, ' '))}</td><td class="px-5 py-3 font-semibold text-slate-700">${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(product.price) || 0)}</td><td class="px-5 py-3"><span class="rounded-full px-2.5 py-1 text-xs font-semibold ${stockClass}">${stock} ${stock === 1 ? 'item' : 'items'}</span></td><td class="whitespace-nowrap px-5 py-3 text-right"><button type="button" data-action="view" data-id="${escapeHtml(product.id)}" class="rounded-lg px-2 py-2 font-semibold text-slate-600 hover:bg-slate-100" aria-label="View details for ${escapeHtml(product.title)}">View</button><button type="button" data-action="edit" data-id="${escapeHtml(product.id)}" class="rounded-lg px-2 py-2 font-semibold text-emerald-700 hover:bg-emerald-50" aria-label="Edit ${escapeHtml(product.title)}">Edit</button><button type="button" data-action="delete" data-id="${escapeHtml(product.id)}" class="rounded-lg px-2 py-2 font-semibold text-slate-400 hover:bg-red-50 hover:text-red-700" aria-label="Delete ${escapeHtml(product.title)}">Delete</button></td></tr>`;
  }).join('');
  status.classList.toggle('hidden', filtered.length > 0);
  if (!filtered.length) status.textContent = query ? 'No products match your search.' : 'No products yet. Add one to get started.';
  $('#page-info').textContent = filtered.length ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length} products` : 'Showing 0 products';
  $('#previous').disabled = state.page <= 1;
  $('#next').disabled = state.page >= pages;
}

function openForm(product) {
  form.reset();
  $('#form-error').classList.add('hidden');
  state.editingId = product ? String(product.id) : null;
  $('#dialog-title').textContent = product ? 'Edit product' : 'Add product';
  saveButton.textContent = product ? 'Save changes' : 'Add product';
  if (product) for (const field of ['title', 'category', 'brand', 'price', 'stock', 'description']) form.elements[field].value = product[field] ?? '';
  dialog.showModal();
}

function openDetails(product) {
  $('#detail-title').textContent = product.title;
  $('#detail-description').textContent = product.description || 'No description available.';
  const image = $('#detail-image');
  image.replaceChildren();
  if (product.thumbnail && /^https?:\/\//i.test(product.thumbnail)) {
    const img = document.createElement('img');
    img.src = product.thumbnail;
    img.alt = product.title;
    img.className = 'h-40 w-full object-contain';
    image.append(img);
  } else {
    image.textContent = '◇';
  }
  const fields = [
    ['Category', product.category ? product.category.replace(/-/g, ' ') : 'Not specified'],
    ['Brand', product.brand || 'Not specified'],
    ['Price', new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(product.price) || 0)],
    ['Stock', `${Number(product.stock) || 0} items`],
    ['SKU', product.sku || 'Not available'],
    ['Rating', product.rating == null ? 'Not available' : `${product.rating} / 5`],
  ];
  $('#detail-fields').innerHTML = fields.map(([label, value]) => `<div><dt class="text-xs font-bold uppercase tracking-wider text-slate-400">${escapeHtml(label)}</dt><dd class="mt-1.5 break-words text-sm font-semibold text-slate-700">${escapeHtml(value)}</dd></div>`).join('');
  $('#edit-detail').onclick = () => { detailDialog.close(); openForm(product); };
  detailDialog.showModal();
}

$('#add-button').addEventListener('click', () => openForm());
$('#close-detail').addEventListener('click', () => detailDialog.close());
$('#dismiss-detail').addEventListener('click', () => detailDialog.close());
$('#close-dialog').addEventListener('click', () => dialog.close());
$('#cancel-dialog').addEventListener('click', () => dialog.close());
$('#search').addEventListener('input', (event) => { state.query = event.target.value; state.page = 1; if (!state.loading) render(); });
$('#previous').addEventListener('click', () => { state.page--; render(); });
$('#next').addEventListener('click', () => { state.page++; render(); });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  for (const field of ['title', 'category', 'brand', 'description']) values[field] = values[field].trim();
  if (!values.title || !values.category) {
    $('#form-error').textContent = 'Product name and category cannot be blank.';
    $('#form-error').classList.remove('hidden');
    return;
  }
  values.price = Number(values.price);
  values.stock = Number(values.stock);
  const existing = state.products.find((product) => String(product.id) === state.editingId);
  saveButton.disabled = true;
  $('#form-error').classList.add('hidden');
  try {
    if (existing) {
      if (!existing.local) await request(`${API}/${existing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      Object.assign(existing, values);
    } else {
      await request(`${API}/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      state.products.unshift({ ...values, id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`, local: true });
      state.query = '';
      $('#search').value = '';
      state.page = 1;
    }
    dialog.close();
    render();
    showToast(existing ? 'Product updated for this session.' : 'Product added for this session.');
  } catch (error) {
    $('#form-error').textContent = 'Could not save the product. Please check your connection and try again.';
    $('#form-error').classList.remove('hidden');
  } finally { saveButton.disabled = false; }
});

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
    if (!product.local) await request(`${API}/${product.id}`, { method: 'DELETE' });
    state.products = state.products.filter((item) => item !== product);
    render();
    showToast('Product deleted for this session.');
  } catch (error) {
    button.disabled = false;
    showToast('Could not delete the product. Please try again.');
  }
});

loadProducts();


