export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function text(value, name, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new HttpError(400, `${name} is invalid.`);
  }
  return value.trim();
}

export function validateProduct(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid product.');
  const product = {
    title: text(body.title, 'Product name', 120, true),
    category: text(body.category, 'Category', 80, true),
    brand: text(body.brand ?? '', 'Brand', 80),
    description: text(body.description ?? '', 'Description', 2000),
  };
  if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price < 0 || body.price > 10000000 ||
      Math.abs(body.price * 100 - Math.round(body.price * 100)) > 0.00001) {
    throw new HttpError(400, 'Price must be nonnegative with at most two decimal places.');
  }
  if (!Number.isInteger(body.stock) || body.stock < 0 || body.stock > 1000000) throw new HttpError(400, 'Stock must be a nonnegative integer.');
  return { ...product, priceCents: Math.round(body.price * 100), stock: body.stock };
}

export function validateCheckout(body) {
  if (!body || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) throw new HttpError(400, 'Select between 1 and 50 different products.');
  if (typeof body.checkoutKey !== 'string' || !/^[a-zA-Z0-9-]{20,100}$/.test(body.checkoutKey)) throw new HttpError(400, 'Invalid checkout key.');
  if (!Number.isSafeInteger(body.expectedTotalCents) || body.expectedTotalCents < 0) throw new HttpError(400, 'Invalid expected total.');
  const ids = new Set();
  const items = body.items.map((item) => {
    if (!item || !Number.isSafeInteger(item.productId) || item.productId <= 0 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000 || ids.has(item.productId)) {
      throw new HttpError(400, 'Invalid product or quantity in bag.');
    }
    ids.add(item.productId);
    return { productId: item.productId, quantity: item.quantity };
  }).sort((a, b) => a.productId - b.productId);
  return { items, checkoutKey: body.checkoutKey, expectedTotalCents: body.expectedTotalCents };
}
