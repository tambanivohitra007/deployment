import { state, SHOWCASE_INTERVAL } from './state.js';
import { $, showToast, reducedMotion } from './utils.js';
import { render, renderOrders, status, dialog } from './admin.js';
import { advanceShowcase, detailDialog } from './store.js';
import { loadSession, signIn, signOut } from './api.js';
import { loadCatalog, loadOrders } from './data.js';
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
    await loadCatalog();
    state.loading = false;
    status.classList.remove('is-loading');
    $('#store-status').classList.remove('is-loading');
    $('#add-button').disabled = !state.admin;
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

// Navigation hides the workspace until signed in; API routes enforce access too.
function showCurrentView() {
  const hash = window.location.hash;
  const view = hash === '#admin' ? (state.admin ? 'admin' : 'login') : hash === '#collection' ? 'collection' : hash === '#cart' ? 'cart' : 'store';
  for (const name of ['store', 'collection', 'cart', 'admin', 'login']) {
    $(`#${name}-view`).classList.toggle('hidden', name !== view);
  }
  const titles = { store: 'Storefront', collection: 'Collection', cart: 'Shopping bag', admin: 'Admin', login: 'Admin sign-in' };
  document.title = `${titles[view]} | Stockroom`;
  for (const [selector, active] of [
    ['#nav-store', view === 'store'],
    ['#nav-collection', view === 'collection'],
    ['#nav-cart', view === 'cart'],
    ['#nav-admin', view === 'admin' || view === 'login'],
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
  if (view === 'admin') refreshWorkspace();
});

async function refreshWorkspace() {
  const button = $('#refresh-admin');
  if (button.disabled || !state.admin) return;
  button.disabled = true;
  try {
    await Promise.all([loadCatalog(), loadOrders()]);
    render();
    renderOrders();
    $('#workspace-status').textContent = 'Workspace is up to date.';
  } catch (error) {
    $('#workspace-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

window.addEventListener('sessionchange', () => {
  showCurrentView();
  $('#admin-email').textContent = state.admin?.email || '';
  $('#add-button').disabled = state.loading || !state.admin;
  if (!state.admin) {
    dialog.close();
    detailDialog.close();
    renderOrders();
  }
});
$('#refresh-admin').addEventListener('click', refreshWorkspace);
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.pendingCheckout) {
    $('#login-error').textContent = 'Finish checking your pending demo order in the bag before signing in.';
    return;
  }
  const form = event.currentTarget;
  const button = $('#login-button');
  button.disabled = true;
  $('#login-error').textContent = '';
  try {
    await signIn(form.elements.email.value, form.elements.password.value);
    form.reset();
    await refreshWorkspace();
    $('#admin-view').focus();
  } catch (error) {
    $('#login-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$('#logout-button').addEventListener('click', async () => {
  if (state.pendingCheckout) return showToast('Finish checking your pending demo order in the bag before signing out.');
  $('#logout-button').disabled = true;
  try {
    await signOut();
    $('#login-view').focus();
  } catch (error) {
    showToast(error.message);
  } finally {
    $('#logout-button').disabled = false;
  }
});

// Establish the session before enabling checkout or showing a protected view.
showCurrentView();
async function start() {
  try {
    await loadSession();
  } catch (error) {
    $('#login-error').textContent = error.message;
    showToast(error.message);
  }
  await loadProducts();
  if (state.admin) await refreshWorkspace();
}
start();
// Stop moving while the user is interacting, viewing a dialog, or on another tab.
setInterval(() => {
  const showcase = $('#showcase');
  if (state.loading || state.showcasePaused || reducedMotion.matches || document.hidden ||
      ['#admin', '#collection', '#cart'].includes(window.location.hash) || dialog.open || detailDialog.open ||
      showcase.matches(':hover') || showcase.contains(document.activeElement) ||
      $('#showcase-stage').classList.contains('is-dragging')) return;
  advanceShowcase(1);
}, SHOWCASE_INTERVAL);
