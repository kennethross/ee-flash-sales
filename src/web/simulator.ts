// The page's view of the API contract. Dates are ISO strings on the wire.
interface ProductView {
  readonly sku: string;
  readonly name: string;
  readonly totalStock: number;
  readonly confirmed: number;
  readonly active: number;
  readonly available: number;
  readonly released: boolean;
  readonly waiting: number;
  readonly releaseAt?: string;
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

type WaitlistState = 'Waiting' | 'Offered' | 'Bought' | 'Passed' | 'Left';

interface WaitlistView {
  readonly id: string;
  readonly sku: string;
  readonly userId: string;
  readonly joinedAt: string;
  readonly state: WaitlistState;
  readonly reservationId: string | undefined;
  readonly position: number | undefined;
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
  readonly waitlist: readonly WaitlistView[];
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
  readonly queue: HTMLUListElement;
  readonly cart: HTMLUListElement;
  readonly bought: HTMLElement;
  readonly status: HTMLElement;
  lines: readonly ReservationView[];
  waiting: readonly WaitlistView[];
  offeredHoldIds: ReadonlySet<string>;
  missed: string;
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
  productRelease: byId('product-release', HTMLInputElement),
  releaseSoon: byId('release-soon', HTMLButtonElement),
  productRows: byId('product-rows', HTMLTableSectionElement),
  waitlists: byId('waitlists', HTMLElement),
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

function setText(root: HTMLElement, selector: string, text: string): void {
  const target = root.querySelector(selector);
  if (target !== null && target.textContent !== text) {
    target.textContent = text;
  }
}

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour12: false });
}

/** Local wall-clock value for a datetime-local input. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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

/** Time left until an ISO instant, by the server's clock: `m:ss`, or `now` once reached. */
function timeUntil(iso: string): string {
  const remainingMs = Date.parse(iso) - (Date.now() + clockOffsetMs);
  if (remainingMs <= 0) {
    return 'now';
  }
  const seconds = Math.ceil(remainingMs / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

function releaseText(product: ProductView): string {
  if (product.released || product.releaseAt === undefined) {
    return '';
  }
  return `on sale at ${timeOfDay(product.releaseAt)} · in ${timeUntil(product.releaseAt)}`;
}

/** A product that is not on sale yet, or has people waiting, takes joins rather than orders. */
function takesQueue(product: ProductView | undefined): boolean {
  return product !== undefined && (!product.released || product.waiting > 0);
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
  const name = el('td');
  name.append(el('span', 'name'), el('span', 'release'));
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
    name,
    stock,
    el('td', 'confirmed'),
    el('td', 'active'),
    el('td', 'available'),
    el('td', 'waiting'),
    actions,
  );
  updateProductRow(row, product);
  return row;
}

function updateProductRow(row: HTMLElement, product: ProductView): void {
  setText(row, '.name', product.name);
  setText(row, '.release', releaseText(product));
  setText(row, '.total', ` ${String(product.totalStock)} `);
  setText(row, '.confirmed', String(product.confirmed));
  setText(row, '.active', String(product.active));
  setText(row, '.available', String(product.available));
  setText(row, '.waiting', String(product.waiting));
  row.querySelector('.available')?.classList.toggle('zero', product.available === 0);
  const minus = row.querySelector('.minus');
  if (minus instanceof HTMLButtonElement) {
    minus.disabled = product.totalStock === 0;
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
  const release = dom.productRelease.value;
  const body =
    release === ''
      ? { sku: slug(name), name, totalStock }
      : { sku: slug(name), name, totalStock, releaseAt: new Date(release).toISOString() };
  const result = await api<ProductView>('POST', '/api/products', body);
  dom.inventoryMessage.textContent = result.ok ? '' : result.error.message;
  if (result.ok) {
    dom.productName.value = '';
    dom.productStock.value = '1';
    dom.productRelease.value = '';
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

function renderWaitlists(snapshot: Snapshot): void {
  const withQueues = snapshot.products.filter((product) =>
    snapshot.waitlist.some((entry) => entry.sku === product.sku),
  );
  reconcile(
    dom.waitlists,
    withQueues,
    (product) => product.sku,
    (product) => {
      const block = el('div', 'waitlist');
      const heading = el('div');
      heading.append(el('span', 'title'), el('span', 'release'));
      block.append(heading, el('ol'));
      updateWaitlistBlock(block, product, snapshot);
      return block;
    },
    (block, product) => {
      updateWaitlistBlock(block, product, snapshot);
    },
  );
}

function updateWaitlistBlock(block: HTMLElement, product: ProductView, snapshot: Snapshot): void {
  setText(block, '.title', product.name);
  setText(block, '.release', releaseText(product));
  const list = block.querySelector('ol');
  if (!(list instanceof HTMLOListElement)) {
    return;
  }
  const entries = snapshot.waitlist.filter((entry) => entry.sku === product.sku);
  reconcile(
    list,
    entries,
    (entry) => entry.id,
    (entry) => {
      const item = el('li');
      item.append(el('span', 'who'), el('span', 'state'));
      updateWaitlistItem(item, entry, snapshot);
      return item;
    },
    (item, entry) => {
      updateWaitlistItem(item, entry, snapshot);
    },
  );
}

function updateWaitlistItem(item: HTMLElement, entry: WaitlistView, snapshot: Snapshot): void {
  item.dataset.state = entry.state;
  setText(item, '.who', `${entry.userId} · `);
  setText(item, '.state', waitlistStateText(entry, snapshot));
}

function waitlistStateText(entry: WaitlistView, snapshot: Snapshot): string {
  switch (entry.state) {
    case 'Waiting':
      return `waiting, #${String(entry.position ?? 0)} in line`;
    case 'Offered': {
      const hold = snapshot.reservations.find((r) => r.id === entry.reservationId);
      return hold === undefined ? 'offered' : `offered · expires in ${countdown(hold)}`;
    }
    case 'Bought':
      return 'bought';
    case 'Passed':
      return 'missed their turn';
    case 'Left':
      return 'left';
  }
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

  const queue = el('ul', 'queue');
  const cart = el('ul', 'cart');
  const actions = el('div', 'actions');
  const checkout = makeButton('Checkout');
  actions.append(checkout);
  const bought = el('p', 'bought');
  const status = el('p', 'status');
  card.append(header, order, queue, cart, actions, bought, status);

  const customer: Customer = {
    name,
    card,
    product,
    quantity,
    addToCart,
    checkout,
    queue,
    cart,
    bought,
    status,
    lines: [],
    waiting: [],
    offeredHoldIds: new Set(),
    missed: '',
    message: '',
  };
  onClick(addToCart, async () => {
    await placeOrder(customer);
    await refresh();
  });
  onClick(checkout, () => checkoutFor(customer));
  onClick(remove, () => removeCustomer(customer));
  product.addEventListener('change', () => {
    if (latest !== undefined) {
      renderCustomer(customer, latest);
    }
  });

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
  const myEntries = snapshot.waitlist.filter((entry) => entry.userId === customer.name);
  customer.lines = mine.filter((reservation) => reservation.state === 'Active');
  customer.waiting = myEntries.filter((entry) => entry.state === 'Waiting');
  customer.offeredHoldIds = new Set(
    myEntries
      .filter((entry) => entry.state === 'Offered' && entry.reservationId !== undefined)
      .map((entry) => entry.reservationId ?? ''),
  );
  const bought = mine.filter((reservation) => reservation.state === 'Confirmed');
  const lastPassed = myEntries.filter((entry) => entry.state === 'Passed').at(-1);
  customer.missed =
    lastPassed === undefined || customer.waiting.length > 0 || customer.lines.length > 0
      ? ''
      : `missed your turn for ${productName(lastPassed.sku)}`;

  const chosen = productsBySku.get(customer.product.value);
  const joining = takesQueue(chosen);
  customer.addToCart.textContent = joining ? 'Join waiting list' : 'Add to cart';
  customer.quantity.disabled = joining;
  customer.addToCart.disabled =
    joining && customer.waiting.some((entry) => entry.sku === chosen?.sku);

  reconcile(
    customer.queue,
    customer.waiting,
    (entry) => entry.id,
    (entry) => createQueueLine(customer, entry),
    updateQueueLine,
  );
  reconcile(
    customer.cart,
    customer.lines,
    (line) => line.id,
    (line) => createCartLine(customer, line),
    (item, line) => {
      updateCartLine(item, line, customer);
    },
  );
  customer.checkout.disabled = customer.lines.length === 0;
  customer.bought.textContent =
    bought.length === 0
      ? ''
      : `Bought: ${bought.map((line) => `${String(line.quantity)} × ${productName(line.sku)}`).join(', ')}`;
  customer.card.dataset.state = cardState(customer, bought.length);
  customer.status.textContent = statusText(customer);
}

function createQueueLine(customer: Customer, entry: WaitlistView): HTMLLIElement {
  const item = el('li');
  const leave = makeButton('Leave', 'link');
  onClick(leave, () => leaveQueue(customer, entry.id));
  item.append(el('span', 'line-name'), el('span', 'countdown'), leave);
  updateQueueLine(item, entry);
  return item;
}

function updateQueueLine(item: HTMLElement, entry: WaitlistView): void {
  const product = productsBySku.get(entry.sku);
  setText(
    item,
    '.line-name',
    `#${String(entry.position ?? 0)} in line for ${productName(entry.sku)}`,
  );
  const when =
    product === undefined || product.released || product.releaseAt === undefined
      ? 'waiting for stock'
      : `on sale in ${timeUntil(product.releaseAt)}`;
  setText(item, '.countdown', when);
}

function createCartLine(customer: Customer, line: ReservationView): HTMLLIElement {
  const item = el('li');
  const remove = makeButton('Remove', 'link');
  onClick(remove, () => removeLine(customer, line.id));
  item.append(el('span', 'line-name'), el('span', 'countdown'), remove);
  updateCartLine(item, line, customer);
  return item;
}

function updateCartLine(item: HTMLElement, line: ReservationView, customer: Customer): void {
  const yourTurn = customer.offeredHoldIds.has(line.id);
  item.classList.toggle('turn', yourTurn);
  setText(
    item,
    '.line-name',
    `${yourTurn ? 'your turn · ' : ''}${String(line.quantity)} × ${productName(line.sku)}`,
  );
  setText(item, '.countdown', `expires in ${countdown(line)}`);
}

function cardState(customer: Customer, boughtCount: number): string {
  if (customer.message !== '') {
    return 'rejected';
  }
  if (customer.lines.length > 0) {
    return 'active';
  }
  if (customer.waiting.length > 0) {
    return 'waiting';
  }
  return boughtCount > 0 ? 'confirmed' : 'idle';
}

function statusText(customer: Customer): string {
  if (customer.message !== '') {
    return customer.message;
  }
  if (customer.missed !== '') {
    return customer.missed;
  }
  if (customer.lines.length === 0 && customer.waiting.length === 0) {
    return 'cart empty';
  }
  const parts: string[] = [];
  if (customer.lines.length > 0) {
    parts.push(`${String(customer.lines.length)} in cart`);
  }
  if (customer.waiting.length > 0) {
    parts.push(`waiting for ${String(customer.waiting.length)}`);
  }
  return parts.join(' · ');
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
        updateCartLine(item, line, customer);
      }
    }
    for (const entry of customer.waiting) {
      const item = customer.queue.querySelector(`[data-key="${entry.id}"]`);
      if (item instanceof HTMLElement) {
        updateQueueLine(item, entry);
      }
    }
  }
  if (latest !== undefined) {
    for (const product of latest.products) {
      const row = dom.productRows.querySelector(`[data-key="${product.sku}"]`);
      if (row instanceof HTMLElement) {
        setText(row, '.release', releaseText(product));
      }
    }
    renderWaitlists(latest);
  }
}

async function placeOrder(customer: Customer): Promise<void> {
  const sku = customer.product.value;
  if (sku === '') {
    customer.message = 'Add a product first.';
    return;
  }
  const path = `/api/products/${encodeURIComponent(sku)}`;
  const result = takesQueue(productsBySku.get(sku))
    ? await api<WaitlistView>('POST', `${path}/waitlist`, { userId: customer.name })
    : await api<ReservationView>('POST', `${path}/reservations`, {
        userId: customer.name,
        quantity: Number(customer.quantity.value),
      });
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

async function leaveQueue(customer: Customer, entryId: string): Promise<void> {
  const result = await api<undefined>('DELETE', `/api/waitlist/${encodeURIComponent(entryId)}`);
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

/** Gives up the customer's holds and places in line so stock comes back, then drops the card. */
async function removeCustomer(customer: Customer): Promise<void> {
  await Promise.all([
    ...customer.lines.map((line) =>
      api<ReservationView>('POST', `/api/reservations/${encodeURIComponent(line.id)}/cancel`),
    ),
    ...customer.waiting.map((entry) =>
      api<undefined>('DELETE', `/api/waitlist/${encodeURIComponent(entry.id)}`),
    ),
  ]);
  const index = customers.indexOf(customer);
  if (index !== -1) {
    customers.splice(index, 1);
  }
  customer.card.remove();
  await refresh();
}

/** Every customer adds their chosen product (or joins its line) at the same instant. */
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
  dom.connection.textContent = `connected · ${String(latest.products.length)} products · ${String(latest.reservations.length)} reservations · ${String(latest.waitlist.length)} in waiting lists`;
  renderProducts(latest);
  renderWaitlists(latest);
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
dom.releaseSoon.addEventListener('click', () => {
  dom.productRelease.value = toLocalInputValue(new Date(Date.now() + clockOffsetMs + 30_000));
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
