import { state } from './state.js';
import { $, escapeHtml, showToast, stockAvailable, formatMoney } from './utils.js';
import { render, renderOrders } from './admin.js';

// Cart and order data are kept in memory, just like the demo catalog.
export function addToCart(product) {
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
