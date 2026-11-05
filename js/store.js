import { state, STORE_PAGE_SIZE } from './state.js';
import { $, escapeHtml, reducedMotion, stockAvailable } from './utils.js';
import { addToCart } from './cart.js';
import { openForm } from './admin.js';

export const detailDialog = $('#detail-dialog');

// The carousel uses real catalog products, with clothing first for the editorial layout.
function showcaseProducts() {
  const clothing = ['tops', 'womens-dresses', 'mens-shirts', 'womens-shoes', 'mens-shoes'];
  return [...state.products].sort((a, b) =>
    Number(clothing.includes(b.category)) - Number(clothing.includes(a.category))
  );
}

export function renderShowcase() {
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

export function advanceShowcase(direction) {
  const count = state.products.length;
  if (count < 2) return;
  state.showcaseIndex = (state.showcaseIndex + direction + count) % count;
  renderShowcase();
}

// Both views use the same in-memory products, but have separate filters and pages.
export function renderStore() {
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

// Show details from the current catalog, including any session edits.
export function openDetails(product, isAdmin = true) {
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
$('#close-detail').addEventListener('click', () => detailDialog.close());
$('#dismiss-detail').addEventListener('click', () => detailDialog.close());
