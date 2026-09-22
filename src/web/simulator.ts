// The page's view of the API contract. Dates are ISO strings on the wire.
interface ProductView {
  readonly sku: string;
  readonly name: string;
  readonly totalStock: number;
  readonly confirmed: number;
  readonly active: number;
  readonly available: number;
}

type ReservationState = 'Active' | 'Confirmed' | 'Cancelled' | 'Expired';

interface ReservationView {
  readonly id: string;
  readonly sku: string;
  readonly userId: string;
  readonly quantity: number;
  readonly state: ReservationState;
  readonly createdAt: string;
  readonly expiresAt: string;
}

interface ActivityView {
  readonly seq: number;
  readonly at: string;
  readonly type: string;
  readonly actor: string;
  readonly message: string;
}

interface Snapshot {
  readonly now: string;
  readonly holdTimeMs: number;
  readonly products: readonly ProductView[];
  readonly reservations: readonly ReservationView[];
  readonly events: readonly ActivityView[];
}

interface ApiError {
  readonly code: string;
  readonly message: string;
}

type ApiResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ApiError };

/** A simulated shopper. Lives only in this page; the cart is their Active reservations on the server. */
interface Customer {
  readonly name: string;
  readonly card: HTMLElement;
  readonly product: HTMLSelectElement;
  readonly quantity: HTMLInputElement;
  readonly addToCart: HTMLButtonElement;
  readonly checkout: HTMLButtonElement;
  readonly cart: HTMLUListElement;
  readonly bought: HTMLElement;
  readonly status: HTMLElement;
  lines: readonly ReservationView[];
  message: string;
}

const ACTIVITY_ROWS = 50;

// ---------- API ----------

async function api<T>(method: string, path: string, body?: object): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
    });
    const json: unknown = response.status === 204 ? undefined : await response.json();
    if (!response.ok) {
      return { ok: false, error: toApiError(json, response.status) };
    }
    // The page trusts the server it ships with; this is the one place the wire type is asserted.
    return { ok: true, value: json as T };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'network error';
    return { ok: false, error: { code: 'NETWORK', message } };
  }
}

function toApiError(json: unknown, status: number): ApiError {
  if (typeof json === 'object' && json !== null && 'error' in json) {
    const { error } = json;
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error &&
      typeof error.code === 'string' &&
      typeof error.message === 'string'
    ) {
      return { code: error.code, message: error.message };
    }
  }
  return { code: 'HTTP', message: `HTTP ${String(status)}` };
}

// ---------- DOM helpers ----------

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Missing element #${id}`);
  }
  return element;
}

const dom = {
  connection: byId('connection', HTMLElement),
  addProductForm: byId('add-product-form', HTMLFormElement),
  productName: byId('product-name', HTMLInputElement),
  productStock: byId('product-stock', HTMLInputElement),
  productRows: byId('product-rows', HTMLTableSectionElement),
  holdTimeForm: byId('hold-time-form', HTMLFormElement),
  holdTime: byId('hold-time', HTMLInputElement),
  resetInventory: byId('reset-inventory', HTMLButtonElement),
  inventoryMessage: byId('inventory-message', HTMLElement),
  activity: byId('activity', HTMLUListElement),
  addCustomer: byId('add-customer', HTMLButtonElement),
  everyoneAdds: byId('everyone-adds', HTMLButtonElement),
  customerCards: byId('customer-cards', HTMLElement),
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== '') {
    element.className = className;
  }
  if (text !== '') {
    element.textContent = text;
  }
  return element;
}

function makeButton(label: string, className = ''): HTMLButtonElement {
  const element = el('button', className, label);
  element.type = 'button';
  return element;
}

function onClick(element: HTMLElement, action: () => Promise<void>): void {
  element.addEventListener('click', () => {
    void action();
  });
}

/**
 * Keeps `container`'s children in step with `items` without recreating elements that are still
 * there, so a button someone is clicking is never swapped out from under the cursor.
 */
function reconcile<T>(
  container: HTMLElement,
  items: readonly T[],
  key: (item: T) => string,
  create: (item: T) => HTMLElement,
  update: (element: HTMLElement, item: T) => void,
): void {
  const existing = new Map<string, HTMLElement>();
  for (const child of container.children) {
    if (child instanceof HTMLElement && child.dataset.key !== undefined) {
      existing.set(child.dataset.key, child);
    }
  }
  const next = items.map((item) => {
    const itemKey = key(item);
    const found = existing.get(itemKey);
    if (found !== undefined) {
      update(found, item);
      return found;
    }
    const element = create(item);
    element.dataset.key = itemKey;
    return element;
  });
  container.replaceChildren(...next);
}

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour12: false });
}

// ---------- State ----------

const customers: Customer[] = [];
const productsBySku = new Map<string, ProductView>();
let nextCustomerNumber = 1;
let latest: Snapshot | undefined;
/** Server clock minus browser clock, so countdowns agree with the server. */
let clockOffsetMs = 0;

function productName(sku: string): string {
  return productsBySku.get(sku)?.name ?? sku;
}

// ---------- Inventory pane ----------

function renderProducts(snapshot: Snapshot): void {
  productsBySku.clear();
  for (const product of snapshot.products) {
    productsBySku.set(product.sku, product);
  }
  reconcile(
    dom.productRows,
    snapshot.products,
    (product) => product.sku,
    createProductRow,
    updateProductRow,
  );
  if (document.activeElement !== dom.holdTime) {
    dom.holdTime.value = String(snapshot.holdTimeMs / 1000);
  }
}

function createProductRow(product: ProductView): HTMLTableRowElement {
  const row = el('tr');
  const stock = el('td');
  const minus = makeButton('−', 'minus');
  const plus = makeButton('+', 'plus');
  onClick(minus, () => adjustStock(product.sku, -1));
  onClick(plus, () => adjustStock(product.sku, 1));
  stock.append(minus, el('span', 'total'), plus);
  const remove = makeButton('Remove');
  onClick(remove, () => removeProduct(product.sku));
  const actions = el('td');
  actions.append(remove);
  row.append(
    el('td', 'name'),
    stock,
    el('td', 'confirmed'),
    el('td', 'active'),
    el('td', 'available'),
    actions,
  );
  updateProductRow(row, product);
  return row;
}

function updateProductRow(row: HTMLElement, product: ProductView): void {
  setText(row, '.name', product.name);
  setText(row, '.total', ` ${String(product.totalStock)} `);
  setText(row, '.confirmed', String(product.confirmed));
  setText(row, '.active', String(product.active));
  setText(row, '.available', String(product.available));
  row.querySelector('.available')?.classList.toggle('zero', product.available === 0);
  const minus = row.querySelector('.minus');
  if (minus instanceof HTMLButtonElement) {
    minus.disabled = product.totalStock === 0;
  }
}

function setText(root: HTMLElement, selector: string, text: string): void {
  const target = root.querySelector(selector);
  if (target !== null && target.textContent !== text) {
    target.textContent = text;
  }
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function addProduct(): Promise<void> {
  const name = dom.productName.value.trim();
  const totalStock = Number(dom.productStock.value);
  const result = await api<ProductView>('POST', '/api/products', {
    sku: slug(name),
    name,
    totalStock,
  });
  dom.inventoryMessage.textContent = result.ok ? '' : result.error.message;
  if (result.ok) {
    dom.productName.value = '';
    dom.productStock.value = '1';
  }
  await refresh();
}

async function adjustStock(sku: string, delta: number): Promise<void> {
  const product = productsBySku.get(sku);
  if (product === undefined) {
    return;
  }
  const result = await api<ProductView>('PATCH', `/api/products/${encodeURIComponent(sku)}`, {
    totalStock: product.totalStock + delta,
  });
  dom.inventoryMessage.textContent = result.ok ? '' : result.error.message;
  await refresh();
}

async function removeProduct(sku: string): Promise<void> {
  const result = await api<undefined>('DELETE', `/api/products/${encodeURIComponent(sku)}`);
  dom.inventoryMessage.textContent = result.ok ? '' : result.error.message;
  await refresh();
}

async function applyHoldTime(): Promise<void> {
  const seconds = Number(dom.holdTime.value);
  const result = await api<{ holdTimeMs: number }>('PUT', '/api/settings/hold-time', {
    holdTimeMs: Math.round(seconds * 1000),
  });
  dom.inventoryMessage.textContent = result.ok
    ? `Hold time set to ${String(seconds)} s for new reservations.`
    : result.error.message;
  dom.holdTime.blur();
  await refresh();
}

async function resetInventory(): Promise<void> {
  const result = await api<Snapshot>('POST', '/api/reset');
  dom.inventoryMessage.textContent = result.ok ? 'Inventory reset.' : result.error.message;
  for (const customer of customers) {
    customer.message = '';
  }
  await refresh();
}

function renderActivity(snapshot: Snapshot): void {
  const newestFirst = [...snapshot.events].reverse().slice(0, ACTIVITY_ROWS);
  // Keyed by sequence and time: a reset restarts the sequence, and the rows must not be reused.
  reconcile(
    dom.activity,
    newestFirst,
    (event) => `${String(event.seq)}@${event.at}`,
    (event) => {
      const item = el('li');
      item.append(el('time'), el('span', 'actor'), el('span', 'text'));
      updateActivityRow(item, event);
      return item;
    },
    updateActivityRow,
  );
}

function updateActivityRow(item: HTMLElement, event: ActivityView): void {
  item.className = `activity-${event.type}`;
  setText(item, 'time', timeOfDay(event.at));
  setText(item, '.actor', event.actor);
  setText(item, '.text', event.message);
}

// ---------- Customers pane ----------

function addCustomer(): void {
  const name = `Customer ${String(nextCustomerNumber)}`;
  nextCustomerNumber += 1;

  const card = el('article', 'card');
  const header = el('header');
  const remove = makeButton('×', 'remove');
  remove.setAttribute('aria-label', `Remove ${name}`);
  header.append(el('h3', '', name), remove);

  const order = el('div', 'order');
  const product = el('select');
  product.setAttribute('aria-label', `${name} product`);
  const quantity = el('input');
  quantity.type = 'number';
  quantity.min = '1';
  quantity.step = '1';
  quantity.value = '1';
  quantity.setAttribute('aria-label', `${name} quantity`);
  const addToCart = makeButton('Add to cart', 'primary');
  order.append(product, quantity, addToCart);

  const cart = el('ul', 'cart');
  const actions = el('div', 'actions');
  const checkout = makeButton('Checkout');
  actions.append(checkout);
  const bought = el('p', 'bought');
  const status = el('p', 'status');
  card.append(header, order, cart, actions, bought, status);

  const customer: Customer = {
    name,
    card,
    product,
    quantity,
    addToCart,
    checkout,
    cart,
    bought,
    status,
    lines: [],
    message: '',
  };
  onClick(addToCart, async () => {
    await placeOrder(customer);
    await refresh();
  });
  onClick(checkout, () => checkoutFor(customer));
  onClick(remove, () => removeCustomer(customer));

  customers.push(customer);
  dom.customerCards.append(card);
  if (latest !== undefined) {
    syncProductPickers(latest);
    renderCustomer(customer, latest);
  }
}

/** Keeps every card's product picker in step with the inventory without resetting a choice. */
function syncProductPickers(snapshot: Snapshot): void {
  const skus = snapshot.products.map((product) => product.sku).join('|');
  for (const customer of customers) {
    if (customer.product.dataset.skus === skus) {
      continue;
    }
    const selected = customer.product.value;
    customer.product.replaceChildren(
      ...snapshot.products.map((product) => new Option(product.name, product.sku)),
    );
    if (snapshot.products.some((product) => product.sku === selected)) {
      customer.product.value = selected;
    }
    customer.product.dataset.skus = skus;
  }
}

function renderCustomer(customer: Customer, snapshot: Snapshot): void {
  const mine = snapshot.reservations.filter((reservation) => reservation.userId === customer.name);
  customer.lines = mine.filter((reservation) => reservation.state === 'Active');
  const bought = mine.filter((reservation) => reservation.state === 'Confirmed');

  reconcile(
    customer.cart,
    customer.lines,
    (line) => line.id,
    (line) => createCartLine(customer, line),
    updateCartLine,
  );
  customer.checkout.disabled = customer.lines.length === 0;
  customer.bought.textContent =
    bought.length === 0
      ? ''
      : `Bought: ${bought.map((line) => `${String(line.quantity)} × ${productName(line.sku)}`).join(', ')}`;
  customer.card.dataset.state = cardState(customer, bought.length);
  customer.status.textContent = statusText(customer);
}

function createCartLine(customer: Customer, line: ReservationView): HTMLLIElement {
  const item = el('li');
  const remove = makeButton('Remove', 'link');
  onClick(remove, () => removeLine(customer, line.id));
  item.append(el('span', 'line-name'), el('span', 'countdown'), remove);
  updateCartLine(item, line);
  return item;
}

function updateCartLine(item: HTMLElement, line: ReservationView): void {
  setText(item, '.line-name', `${String(line.quantity)} × ${productName(line.sku)}`);
  setText(item, '.countdown', `expires in ${countdown(line)}`);
}

function cardState(customer: Customer, boughtCount: number): string {
  if (customer.message !== '') {
    return 'rejected';
  }
  if (customer.lines.length > 0) {
    return 'active';
  }
  return boughtCount > 0 ? 'confirmed' : 'idle';
}

function statusText(customer: Customer): string {
  if (customer.message !== '') {
    return customer.message;
  }
  if (customer.lines.length === 0) {
    return 'cart empty';
  }
  return `${String(customer.lines.length)} in cart`;
}

function countdown(reservation: ReservationView): string {
  const remainingMs = Date.parse(reservation.expiresAt) - (Date.now() + clockOffsetMs);
  if (remainingMs <= 0) {
    return 'expired';
  }
  const seconds = Math.ceil(remainingMs / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

function tickCountdowns(): void {
  for (const customer of customers) {
    for (const line of customer.lines) {
      const item = customer.cart.querySelector(`[data-key="${line.id}"]`);
      if (item instanceof HTMLElement) {
        updateCartLine(item, line);
      }
    }
  }
}

async function placeOrder(customer: Customer): Promise<void> {
  const sku = customer.product.value;
  if (sku === '') {
    customer.message = 'Add a product first.';
    return;
  }
  const result = await api<ReservationView>(
    'POST',
    `/api/products/${encodeURIComponent(sku)}/reservations`,
    { userId: customer.name, quantity: Number(customer.quantity.value) },
  );
  customer.message = result.ok ? '' : result.error.message;
}

async function removeLine(customer: Customer, reservationId: string): Promise<void> {
  const result = await api<ReservationView>(
    'POST',
    `/api/reservations/${encodeURIComponent(reservationId)}/cancel`,
  );
  customer.message = result.ok ? '' : result.error.message;
  await refresh();
}

/** Confirms every line in the cart at once. */
async function checkoutFor(customer: Customer): Promise<void> {
  const results = await Promise.all(
    customer.lines.map((line) =>
      api<ReservationView>('POST', `/api/reservations/${encodeURIComponent(line.id)}/confirm`),
    ),
  );
  const failed = results.find((result) => !result.ok);
  customer.message = failed === undefined ? '' : failed.error.message;
  await refresh();
}

/** Cancels the customer's holds so the stock comes back, then drops the card. */
async function removeCustomer(customer: Customer): Promise<void> {
  await Promise.all(
    customer.lines.map((line) =>
      api<ReservationView>('POST', `/api/reservations/${encodeURIComponent(line.id)}/cancel`),
    ),
  );
  const index = customers.indexOf(customer);
  if (index !== -1) {
    customers.splice(index, 1);
  }
  customer.card.remove();
  await refresh();
}

/** Every customer adds their chosen product at the same instant. */
async function everyoneAddsToCart(): Promise<void> {
  await Promise.all(customers.map(placeOrder));
  await refresh();
}

// ---------- Polling ----------

async function refresh(): Promise<void> {
  const result = await api<Snapshot>('GET', '/api/state');
  if (!result.ok) {
    dom.connection.textContent = `disconnected: ${result.error.message}`;
    return;
  }
  latest = result.value;
  clockOffsetMs = Date.parse(latest.now) - Date.now();
  dom.connection.textContent = `connected · ${String(latest.products.length)} products · ${String(latest.reservations.length)} reservations`;
  renderProducts(latest);
  renderActivity(latest);
  syncProductPickers(latest);
  for (const customer of customers) {
    renderCustomer(customer, latest);
  }
}

// ---------- Wiring ----------

dom.addProductForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void addProduct();
});
dom.holdTimeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void applyHoldTime();
});
onClick(dom.resetInventory, resetInventory);
dom.addCustomer.addEventListener('click', () => {
  addCustomer();
});
onClick(dom.everyoneAdds, everyoneAddsToCart);

addCustomer();
addCustomer();
addCustomer();
void refresh();
setInterval(() => {
  void refresh();
}, 1_000);
setInterval(tickCountdowns, 250);
