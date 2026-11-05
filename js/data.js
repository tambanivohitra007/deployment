import { state, API } from './state.js';
import { request } from './api.js';

export async function loadCatalog() {
  const data = await request(API);
  state.products = data.products;
}

export async function loadOrders() {
  if (!state.admin) return;
  const data = await request('/api/admin/orders');
  // A sign-out may have completed while this request was in flight.
  if (state.admin) state.orders = data.orders;
}
