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

// How many products are visible on each side of the centre of the wave.
const WAVE_RADIUS = 3;
const WAVE_LINE = `<svg class="wave-line" viewBox="0 0 1600 90" preserveAspectRatio="none" aria-hidden="true"><path d="M0 45 Q100 5 200 45 T400 45 T600 45 T800 45 T1000 45 T1200 45 T1400 45 T1600 45" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;

// Sizes depend on the stage, so they are measured each time the wave moves.
function waveMetrics(stage) {
  const narrow = stage.clientWidth < 640;
  return { spacing: stage.clientWidth * (narrow ? 0.4 : 0.22), amplitude: stage.clientHeight * 0.08 };
}

// Place one item on the wave. Offsets can be fractional while the user drags.
function placeWaveItem(node, offset, metrics, radius) {
  const distance = Math.abs(offset);
  const x = offset * metrics.spacing;
  // The wave rises on the left, away from the campaign copy in the top right.
  const y = Math.sin(offset * Math.PI / 2) * metrics.amplitude;
  // Tilt side items to follow the slope of the wave; the centre stays upright.
  const tilt = 8 * Math.cos(offset * Math.PI / 2) * Math.min(distance, 1);
  const scale = 1 - Math.min(distance, radius + 1) * 0.17;
  node.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${tilt}deg) scale(${scale})`;
  node.style.opacity = distance > radius + 0.5 ? '0' : String(Math.max(0, 1 - distance * 0.26));
  node.style.zIndex = String(100 - Math.round(distance * 10));
  // Farther items start later, so each move ripples outward like a wave.
  node.style.transitionDelay = `${Math.round(Math.min(distance, radius) * 40)}ms`;
}

function positionWave(shift = 0) {
  const stage = $('#showcase-stage');
  const track = stage.querySelector('.wave-track');
  if (!track) return;
  const metrics = waveMetrics(stage);
  for (const node of track.children) {
    if (!node.dataset.leaving) placeWaveItem(node, node.waveOffset + shift, metrics, track.waveRadius);
  }
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
    ? `<img src="${escapeHtml(product.thumbnail)}" alt="" draggable="false">`
    : '<span class="showcase-placeholder" aria-hidden="true">◇</span>';

  let track = stage.querySelector('.wave-track');
  if (!track) {
    stage.innerHTML = `${WAVE_LINE}<div class="wave-track"></div>`;
    track = stage.querySelector('.wave-track');
  }
  const hadFocus = stage.contains(document.activeElement);
  const count = products.length;
  const radius = Math.min(WAVE_RADIUS, Math.floor((count - 1) / 2));
  track.waveRadius = radius;
  const wanted = new Map();
  for (let offset = -radius; offset <= radius; offset++) {
    const product = products[(state.showcaseIndex + offset + count) % count];
    wanted.set(String(product.id), { product, offset });
  }

  // Keep existing items so they can glide to their new place instead of being redrawn.
  const metrics = waveMetrics(stage);
  const nodes = new Map();
  for (const node of [...track.children]) {
    if (node.dataset.leaving) continue;
    if (wanted.has(node.dataset.productId)) {
      nodes.set(node.dataset.productId, node);
      continue;
    }
    node.dataset.leaving = 'true';
    node.tabIndex = -1;
    placeWaveItem(node, Math.sign(node.waveOffset) * (radius + 1), metrics, radius);
    setTimeout(() => node.remove(), 900);
  }

  let added = false;
  for (const [id, { product, offset }] of wanted) {
    let node = nodes.get(id);
    if (!node) {
      node = document.createElement('button');
      node.type = 'button';
      node.className = 'wave-item';
      node.dataset.productId = id;
      // New items enter from just beyond the edge they appear on.
      node.waveOffset = offset + (offset < 0 ? -1 : 1);
      track.append(node);
      placeWaveItem(node, node.waveOffset, metrics, radius);
      node.style.opacity = '0';
      nodes.set(id, node);
      added = true;
    }
    if (node.imageSource !== product.thumbnail) {
      node.innerHTML = imageFor(product);
      node.imageSource = product.thumbnail;
    }
    node.waveOffset = offset;
    // Only the centre product opens details; side items move the wave instead.
    if (offset === 0) {
      node.dataset.storeId = id;
      delete node.dataset.waveStep;
      node.setAttribute('aria-label', `View details for ${product.title}`);
      node.removeAttribute('aria-hidden');
      node.tabIndex = 0;
    } else {
      delete node.dataset.storeId;
      node.dataset.waveStep = String(offset);
      node.removeAttribute('aria-label');
      node.setAttribute('aria-hidden', 'true');
      node.tabIndex = -1;
    }
  }
  // Apply the starting positions of new items before animating them in.
  if (added) void track.offsetWidth;
  positionWave();
  if (hadFocus) nodes.get(String(current.id))?.focus({ preventScroll: true });

  const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(current.price) || 0);
  $('#showcase-caption').innerHTML = `<span class="campaign-kicker">${escapeHtml((current.category || 'Featured product').replace(/-/g, ' '))} · ${state.showcaseIndex + 1} / ${products.length}</span><p>${escapeHtml(current.title)}</p><span>${price}</span>`;
}

export function advanceShowcase(direction) {
  const count = state.products.length;
  if (count < 2) return;
  state.showcaseIndex = ((state.showcaseIndex + direction) % count + count) % count;
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

// Swipe or drag the wave. The pointer is captured only once the user clearly
// moves sideways, so taps still open details and vertical scrolling still works.
const showcaseStage = $('#showcase-stage');
let drag = null;
let suppressClick = false;
showcaseStage.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || state.products.length < 2 || !showcaseStage.querySelector('.wave-item')) return;
  drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, time: event.timeStamp, velocity: 0, moved: false };
});
showcaseStage.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.startX;
  if (!drag.moved) {
    if (Math.abs(dx) < 8) return;
    if (Math.abs(event.clientY - drag.startY) > Math.abs(dx)) {
      drag = null;
      return;
    }
    drag.moved = true;
    showcaseStage.setPointerCapture(event.pointerId);
    showcaseStage.classList.add('is-dragging');
  }
  drag.velocity = (event.clientX - drag.x) / Math.max(1, event.timeStamp - drag.time);
  drag.x = event.clientX;
  drag.time = event.timeStamp;
  const radius = showcaseStage.querySelector('.wave-track').waveRadius;
  const shift = dx / waveMetrics(showcaseStage).spacing;
  positionWave(Math.max(-radius, Math.min(radius, shift)));
});
function endDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const finished = drag;
  drag = null;
  if (!finished.moved) return;
  showcaseStage.classList.remove('is-dragging');
  // The click that follows a drag should not open product details.
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  let steps = 0;
  if (event.type === 'pointerup') {
    steps = Math.round(-(event.clientX - finished.startX) / waveMetrics(showcaseStage).spacing);
    // A quick flick moves one product even if the distance was short.
    if (!steps && Math.abs(finished.velocity) > 0.35) steps = finished.velocity < 0 ? 1 : -1;
  }
  if (steps) advanceShowcase(steps);
  else positionWave();
}
showcaseStage.addEventListener('pointerup', endDrag);
showcaseStage.addEventListener('pointercancel', endDrag);
showcaseStage.addEventListener('click', (event) => {
  if (suppressClick) {
    event.stopImmediatePropagation();
    return;
  }
  const side = event.target.closest('[data-wave-step]');
  if (!side) return;
  // Stop here so the item that just moved to the centre does not also open.
  event.stopImmediatePropagation();
  advanceShowcase(Number(side.dataset.waveStep));
}, true);
$('#showcase').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') advanceShowcase(-1);
  else if (event.key === 'ArrowRight') advanceShowcase(1);
  else return;
  event.preventDefault();
});
new ResizeObserver(() => positionWave()).observe(showcaseStage);
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
