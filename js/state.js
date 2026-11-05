export const API = 'https://dummyjson.com/products';
export const PAGE_SIZE = 10;
export const STORE_PAGE_SIZE = 12;
export const SHOWCASE_INTERVAL = 5000;
// This catalog lives in the browser. DummyJSON simulates writes, so changes
// disappear when the page is refreshed.
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
  editingId: null,
  loading: true,
};
