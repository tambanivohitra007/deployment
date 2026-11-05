export const API = '/api/products';
export const PAGE_SIZE = 10;
export const STORE_PAGE_SIZE = 12;
export const SHOWCASE_INTERVAL = 5000;
// These are browser copies of server data. SQLite is the source of truth.
export const state = {
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
  admin: null,
  authReady: false,
  checkoutBusy: false,
  pendingCheckout: null,
  editingId: null,
  editingVersion: null,
  loading: true,
};
