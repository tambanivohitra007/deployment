import { state, API, SHOWCASE_INTERVAL } from './state.js';
import { $, request, reducedMotion } from './utils.js';
import { render, status, dialog } from './admin.js';
import { advanceShowcase, detailDialog } from './store.js';
import './cart.js';

// Wait for the catalog before allowing actions that depend on it.
$('#add-button').disabled = true;
$('#search').disabled = true;
$('#store-search').disabled = true;
$('#store-category').disabled = true;
$('#store-previous').disabled = true;
$('#store-next').disabled = true;

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

window.addEventListener('hashchange', () => {
  const view = showCurrentView();
  window.scrollTo(0, 0);
  $(`#${view}-view`).focus({ preventScroll: true });
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
