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

interface Snapshot {
  readonly now: string;
  readonly holdTimeMs: number;
  readonly products: readonly ProductView[];
  readonly reservations: readonly ReservationView[];
}

interface ApiError {
  readonly code: string;
  readonly message: string;
}

type ApiResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ApiError };

/** A simulated shopper. Lives only in this page; its reservations live on the server. */
interface Customer {
  readonly name: string;
  readonly card: HTMLElement;
  readonly product: HTMLSelectElement;
  readonly buy: HTMLButtonElement;
  readonly confirm: HTMLButtonElement;
  readonly cancel: HTMLButtonElement;
  readonly status: HTMLElement;
  reservation: ReservationView | undefined;
  message: string;
}

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

// ---------- DOM ----------

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
  inventoryMessage: byId('inventory-message', HTMLElement),
  addCustomer: byId('add-customer', HTMLButtonElement),
  everyoneBuys: byId('everyone-buys', HTMLButtonElement),
  customerCards: byId('customer-cards', HTMLElement),
};

function makeButton(label: string, className = ''): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  if (className !== '') {
    element.className = className;
  }
  return element;
}

function onClick(element: HTMLElement, action: () => Promise<void>): void {
  element.addEventListener('click', () => {
    void action();
  });
}

function cell(text: string, className = ''): HTMLTableCellElement {
  const element = document.createElement('td');
  element.textContent = text;
  if (className !== '') {
    element.className = className;
  }
  return element;
}

// ---------- State ----------

const customers: Customer[] = [];
let latest: Snapshot | undefined;
/** Server clock minus browser clock, so countdowns agree with the server. */
let clockOffsetMs = 0;

function productName(sku: string): string {
  return latest?.products.find((product) => product.sku === sku)?.name ?? sku;
}

// ---------- Inventory pane ----------

function renderProducts(snapshot: Snapshot): void {
  dom.productRows.replaceChildren(...snapshot.products.map(productRow));
  if (document.activeElement !== dom.holdTime) {
    dom.holdTime.value = String(snapshot.holdTimeMs / 1000);
  }
}

function productRow(product: ProductView): HTMLTableRowElement {
  const row = document.createElement('tr');
  const stock = document.createElement('td');
  const minus = makeButton('−');
  const plus = makeButton('+');
  onClick(minus, () => adjustStock(product, -1));
  onClick(plus, () => adjustStock(product, 1));
  minus.disabled = product.totalStock === 0;
  stock.append(minus, ` ${String(product.totalStock)} `, plus);
  const remove = makeButton('Remove');
  onClick(remove, () => removeProduct(product));
  row.append(
    cell(product.name),
    stock,
    cell(String(product.confirmed)),
    cell(String(product.active)),
    cell(String(product.available), product.available === 0 ? 'zero' : ''),
    cell(''),
  );
  row.lastElementChild?.append(remove);
  return row;
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

async function adjustStock(product: ProductView, delta: number): Promise<void> {
  const result = await api<ProductView>(
    'PATCH',
    `/api/products/${encodeURIComponent(product.sku)}`,
    {
      totalStock: product.totalStock + delta,
    },
  );
  dom.inventoryMessage.textContent = result.ok ? '' : result.error.message;
  await refresh();
}

async function removeProduct(product: ProductView): Promise<void> {
  const result = await api<undefined>('DELETE', `/api/products/${encodeURIComponent(product.sku)}`);
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

// ---------- Customers pane ----------

function addCustomer(): void {
  const name = `Customer ${String(customers.length + 1)}`;
  const card = document.createElement('article');
  card.className = 'card';
  const title = document.createElement('h3');
  title.textContent = name;
  const product = document.createElement('select');
  product.setAttribute('aria-label', `${name} product`);
  const buy = makeButton('Buy', 'primary');
  const confirm = makeButton('Confirm');
  const cancel = makeButton('Cancel');
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(buy, confirm, cancel);
  const status = document.createElement('p');
  status.className = 'status';
  card.append(title, product, actions, status);

  const customer: Customer = {
    name,
    card,
    product,
    buy,
    confirm,
    cancel,
    status,
    reservation: undefined,
    message: '',
  };
  onClick(buy, async () => {
    await placeOrder(customer);
    await refresh();
  });
  onClick(confirm, () => act(customer, 'confirm'));
  onClick(cancel, () => act(customer, 'cancel'));

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

/** Reservations arrive in creation order, so the last one for a user is the current one. */
function latestReservationFor(userId: string, snapshot: Snapshot): ReservationView | undefined {
  return snapshot.reservations.filter((reservation) => reservation.userId === userId).at(-1);
}

function renderCustomer(customer: Customer, snapshot: Snapshot): void {
  customer.reservation = latestReservationFor(customer.name, snapshot);
  const holdsStock = customer.reservation?.state === 'Active';
  customer.buy.disabled = holdsStock;
  customer.confirm.disabled = !holdsStock;
  customer.cancel.disabled = !holdsStock;
  customer.product.disabled = holdsStock;
  customer.card.dataset.state =
    customer.message !== '' ? 'rejected' : (customer.reservation?.state.toLowerCase() ?? 'idle');
  customer.status.textContent = statusText(customer);
}

function statusText(customer: Customer): string {
  const reservation = customer.reservation;
  if (reservation?.state === 'Active') {
    return `reserved ${productName(reservation.sku)} · expires in ${countdown(reservation)}`;
  }
  if (customer.message !== '') {
    return customer.message;
  }
  if (reservation === undefined) {
    return 'idle';
  }
  return `${reservation.state.toLowerCase()} · ${productName(reservation.sku)}`;
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
    if (customer.reservation?.state === 'Active') {
      customer.status.textContent = statusText(customer);
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
    { userId: customer.name },
  );
  customer.message = result.ok ? '' : result.error.message;
}

async function act(customer: Customer, action: 'confirm' | 'cancel'): Promise<void> {
  if (customer.reservation === undefined) {
    return;
  }
  const result = await api<ReservationView>(
    'POST',
    `/api/reservations/${encodeURIComponent(customer.reservation.id)}/${action}`,
  );
  customer.message = result.ok ? '' : result.error.message;
  await refresh();
}

/** Every customer without an active hold clicks Buy at the same instant. */
async function everyoneBuys(): Promise<void> {
  const idle = customers.filter((customer) => customer.reservation?.state !== 'Active');
  await Promise.all(idle.map(placeOrder));
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
dom.addCustomer.addEventListener('click', () => {
  addCustomer();
});
onClick(dom.everyoneBuys, everyoneBuys);

addCustomer();
addCustomer();
addCustomer();
void refresh();
setInterval(() => {
  void refresh();
}, 1_000);
setInterval(tickCountdowns, 250);
