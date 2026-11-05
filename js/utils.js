// A short helper for finding elements defined in index.html.
export const $ = (selector) => document.querySelector(selector);
export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let toastTimer;

// Escape product data before inserting it into an HTML template.
export function escapeHtml(value) {
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
export function showToast(message) {
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

export { request } from './api.js';

export function stockAvailable(product) {
  return Math.max(0, Math.floor(Number(product.stock) || 0));
}

export function formatMoney(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
