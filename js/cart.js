import { state } from './state.js';
import { $, escapeHtml, showToast, stockAvailable, formatMoney, request } from './utils.js';
import { render, renderOrders } from './admin.js';
import { loadCatalog, loadOrders } from './data.js';
import { loadSession } from './api.js';

// Keep the bag and an unfinished checkout across refreshes in this browser tab.
// Never store passwords or session tokens here.
const storageKey = 'stockroom-bag-v1';
try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey));
  if (Array.isArray(saved?.cart)) {
    state.cart = saved.cart.filter((item) => item && /^\d+$/.test(item.id) && Number.isInteger(item.quantity) && item.quantity > 0)
      .map((item) => ({ id: String(item.id), quantity: item.quantity }));
  }
  if (saved?.pendingCheckout?.checkoutKey && Array.isArray(saved.pendingCheckout.items)) state.pendingCheckout = saved.pendingCheckout;
} catch { /* Storage may be disabled; the bag still works until the page closes. */ }

function saveBag() {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ cart: state.cart, pendingCheckout: state.pendingCheckout }));
  } catch { /* Private browsing can make storage unavailable. */ }
}

export function addToCart(product) {
  if (state.pendingCheckout || state.checkoutBusy) {
    showToast('Check your pending order in the bag before adding more items.');
    return false;
  }
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

export function renderCart() {
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
  const locked = state.checkoutBusy || Boolean(state.pendingCheckout);
  for (const button of $('#cart-items').querySelectorAll('button')) {
    if (locked) button.disabled = true;
  }
  $('#place-order').disabled = state.checkoutBusy || (!state.pendingCheckout && quantity === 0);
  $('#place-order').textContent = state.checkoutBusy ? 'Checking order…' : state.pendingCheckout ? 'Check pending order' : 'Place demo order';
  if (state.pendingCheckout && !state.cartNotice) state.cartNotice = 'Your last checkout has not been confirmed. Check the pending order before starting another.';
  $('#cart-notice').textContent = state.cartNotice;
  $('#cart-notice').classList.toggle('hidden', !state.cartNotice);
  const confirmation = $('#order-confirmation');
  confirmation.classList.toggle('hidden', !state.lastOrder);
  confirmation.innerHTML = state.lastOrder
    ? `<strong>Demo order saved · ${escapeHtml(state.lastOrder.reference)}</strong>${state.lastOrder.quantity} ${state.lastOrder.quantity === 1 ? 'item' : 'items'} · ${formatMoney(state.lastOrder.totalCents)}. No payment was taken or delivery arranged. Inventory has been updated.`
    : '';
  saveBag();
  return adjusted;
}

$('#cart-items').addEventListener('click', (event) => {
  if (state.checkoutBusy || state.pendingCheckout) return;
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
$('#place-order').addEventListener('click', async () => {
  if (state.checkoutBusy) return;
  // If stock changed, let the shopper review the adjusted bag before ordering.
  if (!state.pendingCheckout && (renderCart() || !state.cart.length)) return;
  state.checkoutBusy = true;
  try {
    if (!state.authReady) await loadSession();
    if (!state.pendingCheckout) {
      state.pendingCheckout = {
        checkoutKey: crypto.randomUUID(),
        items: state.cart.map((item) => ({ productId: Number(item.id), quantity: item.quantity })),
        expectedTotalCents: state.cart.reduce((total, item) => {
          const product = state.products.find((entry) => String(entry.id) === item.id);
          return total + Math.round(product.price * 100) * item.quantity;
        }, 0),
      };
    }
    // Save the key BEFORE the request; a lost response must not create a second order.
    saveBag();
    renderCart();
    const data = await request('/api/orders', { method: 'POST', body: JSON.stringify(state.pendingCheckout) });
    state.lastOrder = data.order;
    state.pendingCheckout = null;
    state.cart = [];
    state.cartNotice = '';
    saveBag();
  } catch (error) {
    // A validation rejection is definite. Network/server errors retain the same key for retry.
    if (error.status >= 400 && error.status < 500 && error.status !== 429) state.pendingCheckout = null;
    state.cartNotice = error.message;
    if (state.pendingCheckout) state.cartNotice += ' Use “Check pending order” to safely retry.';
  } finally {
    try {
      await Promise.all([loadCatalog(), loadOrders()]);
    } catch {
      state.cartNotice += ' The latest catalog could not be loaded. Refresh when your connection returns.';
    }
    state.checkoutBusy = false;
    render();
    renderOrders();
  }
});
