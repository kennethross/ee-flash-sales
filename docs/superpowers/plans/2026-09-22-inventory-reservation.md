# Inventory Reservation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript inventory reservation service that cannot oversell under concurrent load, with an HTTP API, a flash-sale simulator page, and a written locking strategy.

**Architecture:** A pure domain (products, a four-state reservation machine, stock arithmetic) under an application service that wraps every write in a per-SKU promise-chain mutex around load → decide → save. Infrastructure is one `Map`-backed store with asynchronous methods, a system clock and the mutex; Hono exposes eight JSON routes and serves the static page.

**Tech Stack:** Node ≥ 22.13, TypeScript 6 (strict), Vitest 5, ESLint 10 + typescript-eslint 8 (`strictTypeChecked`), Prettier 3, Hono 4.13 + `@hono/node-server` 2.1, Husky 9.1, tsx.

**Spec:** `docs/superpowers/specs/2026-09-22-inventory-reservation-design.md`

## Global Constraints

- Node `>=22.13.0`; `.nvmrc` says `22`; CI runs on Node 22 and 24.
- Runtime dependencies: `hono` and `@hono/node-server` only.
- No `any`, no `!` non-null assertions; ESLint `strictTypeChecked` + `stylisticTypeChecked` must be clean. Numbers inside template literals go through `String(...)`.
- Failure codes: `OUT_OF_STOCK | NOT_FOUND | INVALID_STATE | VALIDATION | ALREADY_EXISTS`. Statuses: `VALIDATION` 400, `NOT_FOUND` 404, the other three 409.
- Default hold time `120_000` ms; a reservation is expired at `expiresAt` exactly (`expiresAt <= now`).
- Seeded product: sku `flash-ticket`, name `Flash Sale Ticket`, stock 1.
- Every test `describe` that covers a requirement starts with its ID (`R1` … `R11`).
- Commit subjects match `^(feat|fix|refactor|test|docs|chore|ci|build|perf)(\([a-z-]+\))?!?: .{1,72}$`; internal docs go in `docs(internal):` commits; never `--no-verify`.
- Repo-local git identity: `k5hr2s` / `kennethrosspalermo@gmail.com`. Nothing is pushed.
- Prettier: `{ "singleQuote": true, "printWidth": 100, "trailingComma": "all" }`.
- Code blocks below marked `path=<file>` are complete files. A later block with the same path replaces the earlier one.

---

## File structure

```
src/
  domain/failures.ts             FailureCode, Failure, Ok, Fail, Result, ok(), fail()
  domain/reservation.ts          Reservation types; isActive, expireIfDue, confirmReservation, cancelReservation
  domain/product.ts              Sku, Product, ProductView; stockCounts(), available()
  application/ports.ts           InventoryStore, LockManager, Clock interfaces
  application/inventory-service.ts  InventoryService, Snapshot, CreateProductInput, DEFAULT_HOLD_TIME_MS
  infrastructure/clock.ts        SystemClock
  infrastructure/mutex.ts        Mutex, KeyedMutex, NoLock
  infrastructure/store.ts        InMemoryStore
  http/guards.ts                 parseCreateProduct, parseAdjustStock, parseReserve, parseHoldTime
  http/app.ts                    createApp(service)
  http/server.ts                 startServer({ port }), DEMO_PRODUCT
  main.ts                        entry point for `npm start`
  web/simulator.ts               browser code (compiled to public/simulator.js)
public/index.html                the two-pane page
tests/                           mirrors src/, plus tests/support/{builders,fake-clock,service,timing}.ts
```

`ports.ts` lives in `application/` rather than `infrastructure/` (a deviation from the spec's file
list) so that imports only ever point downward: infrastructure implements application's interfaces.

---

## Phase 0 — Foundations

### Task 1: Repository, toolchain, hooks, CI

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.web.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `.nvmrc`, `vitest.config.ts`, `.github/workflows/ci.yml`, `.husky/pre-commit`, `.husky/commit-msg`
- Existing (commit as internal docs): `docs/MISSION.md`, `docs/working/JOURNAL.md`, `docs/superpowers/specs/2026-09-22-inventory-reservation-design.md`, this plan

**Interfaces:**
- Produces: npm scripts `start`, `build:web`, `test`, `test:watch`, `test:coverage`, `lint`, `format`, `format:check`, `typecheck`, `prepare`; two tsconfigs (`tsconfig.json` for `src` minus `src/web`, plus `tests`; `tsconfig.web.json` for `src/web` → `public/`).

- [ ] **Step 1: Initialise the repository with a repo-local identity**

```bash
cd /Users/kennethpalermo/Documents/projects/ee-inventory
git init -b main
git config user.name "k5hr2s"
git config user.email "kennethrosspalermo@gmail.com"
git config user.name && git config user.email   # expect k5hr2s / kennethrosspalermo@gmail.com
```

- [ ] **Step 2: Install dependencies**

```bash
npm init -y >/dev/null
npm pkg set type=module private=true name=inventory-reservation version=1.0.0 \
  description="Inventory reservation service that does not oversell under concurrent load" \
  engines.node=">=22.13.0"
npm install hono@^4.13.8 @hono/node-server@^2.1.1
npm install -D typescript@^6.0.3 vitest@^5.0.1 @vitest/coverage-v8@^5.0.1 eslint@^10.11.0 \
  @eslint/js@^10.0.1 typescript-eslint@^8.70.0 prettier@^3.9.8 tsx@^4.23.15 @types/node@^26.6.2 husky@^9.1.7
npm audit   # expect 0 vulnerabilities
```

- [ ] **Step 3: Set the scripts**

```bash
npm pkg set scripts.start="npm run build:web && tsx src/main.ts" \
  scripts.build:web="tsc -p tsconfig.web.json" \
  scripts.test="vitest run" scripts.test:watch="vitest" scripts.test:coverage="vitest run --coverage" \
  scripts.lint="eslint ." scripts.format="prettier --write ." scripts.format:check="prettier --check ." \
  scripts.typecheck="tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.web.json" \
  scripts.prepare="husky"
npm pkg delete main scripts.test_placeholder 2>/dev/null; npm pkg delete keywords author license 2>/dev/null; true
```

Then open `package.json` and make sure it reads (versions as resolved by npm):

```json path=package.json
{
  "name": "inventory-reservation",
  "version": "1.0.0",
  "description": "Inventory reservation service that does not oversell under concurrent load",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.13.0"
  },
  "scripts": {
    "start": "npm run build:web && tsx src/main.ts",
    "build:web": "tsc -p tsconfig.web.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.web.json",
    "prepare": "husky"
  },
  "dependencies": {
    "@hono/node-server": "^2.1.1",
    "hono": "^4.13.8"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/node": "^26.6.2",
    "@vitest/coverage-v8": "^5.0.1",
    "eslint": "^10.11.0",
    "husky": "^9.1.7",
    "prettier": "^3.9.8",
    "tsx": "^4.23.15",
    "typescript": "^6.0.3",
    "typescript-eslint": "^8.70.0",
    "vitest": "^5.0.1"
  }
}
```

- [ ] **Step 4: Write the config files**

```json path=tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2024"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "vitest.config.ts"],
  "exclude": ["src/web"]
}
```

```json path=tsconfig.web.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": [],
    "rootDir": "src/web",
    "outDir": "public"
  },
  "include": ["src/web"]
}
```

```js path=eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'coverage', 'public/simulator.js'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.web.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  { files: ['**/*.js'], ...tseslint.configs.disableTypeChecked },
);
```

```json path=.prettierrc.json
{ "singleQuote": true, "printWidth": 100, "trailingComma": "all" }
```

```text path=.prettierignore
node_modules
coverage
public/simulator.js
package-lock.json
*.md
```

```text path=.gitignore
node_modules/
coverage/
public/simulator.js
.DS_Store
*.log
```

```text path=.nvmrc
22
```

```ts path=vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/web/**', 'src/main.ts'],
    },
  },
});
```

```yaml path=.github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [22, 24]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm run format:check
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
```

- [ ] **Step 5: Create the hooks**

```bash
npx husky   # creates .husky/_ and sets core.hooksPath
mkdir -p .husky
```

```sh path=.husky/pre-commit
npm run format:check && npm run lint && npm run typecheck && npm test
```

```sh path=.husky/commit-msg
subject=$(head -n1 "$1")
pattern='^(feat|fix|refactor|test|docs|chore|ci|build|perf)(\([a-z-]+\))?!?: .{1,72}$'
if ! printf '%s\n' "$subject" | grep -Eq "$pattern"; then
  echo "commit-msg: subject must be '<type>(<scope>)?: <summary>' (max 72 chars)." >&2
  echo "  types: feat fix refactor test docs chore ci build perf" >&2
  echo "  got:   $subject" >&2
  exit 1
fi
```

```bash
chmod +x .husky/pre-commit .husky/commit-msg
git config core.hooksPath   # expect .husky/_
```

- [ ] **Step 6: Placeholder-free empty source tree so every script runs**

```bash
mkdir -p src/web tests public
```

`src/web` must contain a file for `tsc -p tsconfig.web.json` to have an input, and `public/` must exist for the build output. Create the first version of the browser module (replaced in Task 14):

```ts path=src/web/simulator.ts
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
```

- [ ] **Step 7: Run every script and confirm exit 0**

```bash
npm run format          # writes; then
npm run format:check    # expect "All matched files use Prettier code style!"
npm run lint            # expect no output, exit 0
npm run typecheck       # expect exit 0
npx vitest run --passWithNoTests   # expect "No test files found", exit 0
npm run build:web && ls public/simulator.js && rm public/simulator.js
```

- [ ] **Step 8: Prove the hooks work**

```bash
git add -A
git commit -m "bad subject line" ; echo "exit: $?"    # expect the commit-msg error and exit 1
```

- [ ] **Step 9: Commit the scaffold and the internal docs separately**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.web.json eslint.config.js .prettierrc.json \
  .prettierignore .gitignore .nvmrc vitest.config.ts src/web/simulator.ts
git commit -m "chore: scaffold TypeScript, Vitest, ESLint strict and Prettier toolchain"
git add .husky/pre-commit .husky/commit-msg
git commit -m "chore: enforce conventional commits and a green pre-commit"
git add .github/workflows/ci.yml
git commit -m "ci: run format, lint, typecheck and tests on Node 22 and 24"
git add docs/
git commit -m "docs(internal): mission, design spec, implementation plan and journal"
git log --oneline   # expect four commits
```

---

## Phase 1 — Domain

### Task 2: Failures as values

**Files:**
- Create: `src/domain/failures.ts`
- Test: `tests/domain/failures.test.ts`

**Interfaces:**
- Produces: `type FailureCode`, `interface Failure { code; message }`, `interface Ok<T> { ok: true; value: T }`, `interface Fail { ok: false; failure: Failure }`, `type Result<T> = Ok<T> | Fail`, `ok<T>(value: T): Ok<T>`, `fail(code: FailureCode, message: string): Fail`.

- [ ] **Step 1: Write the failing test**

```ts path=tests/domain/failures.test.ts
import { describe, expect, it } from 'vitest';
import { fail, ok, type Result } from '../../src/domain/failures';

describe('Result', () => {
  it('ok carries a value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('fail carries a code and a message', () => {
    expect(fail('OUT_OF_STOCK', 'Sold out')).toEqual({
      ok: false,
      failure: { code: 'OUT_OF_STOCK', message: 'Sold out' },
    });
  });

  it('narrows on the ok flag', () => {
    const results: Result<number>[] = [ok(1), fail('VALIDATION', 'bad')];
    const values = results.map((result) => (result.ok ? result.value : result.failure.code));
    expect(values).toEqual([1, 'VALIDATION']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/domain/failures.test.ts`
Expected: FAIL — `Cannot find module '../../src/domain/failures'`

- [ ] **Step 3: Implement**

```ts path=src/domain/failures.ts
export type FailureCode =
  'OUT_OF_STOCK' | 'NOT_FOUND' | 'INVALID_STATE' | 'VALIDATION' | 'ALREADY_EXISTS';

export interface Failure {
  readonly code: FailureCode;
  readonly message: string;
}

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Fail {
  readonly ok: false;
  readonly failure: Failure;
}

/** Domain outcomes are values, not exceptions: callers must look at `ok` before using `value`. */
export type Result<T> = Ok<T> | Fail;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function fail(code: FailureCode, message: string): Fail {
  return { ok: false, failure: { code, message } };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/domain/failures.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/domain/failures.ts tests/domain/failures.test.ts
git commit -m "feat: failures as values with a Result type"
```

### Task 3: Reservation state machine

**Files:**
- Create: `src/domain/reservation.ts`, `tests/support/builders.ts`
- Test: `tests/domain/reservation.test.ts`

**Interfaces:**
- Consumes: `Result`, `ok`, `fail` from Task 2; `type Sku` from Task 4 (type-only import, no runtime cycle).
- Produces: `type ReservationId = string`, `type UserId = string`, `type ReservationState`, `interface Reservation { id; sku; userId; quantity; state; createdAt: Date; expiresAt: Date }`, `isActive(r, now): boolean`, `expireIfDue(r, now): Reservation` (same object when nothing changes), `confirmReservation(r, now): Result<Reservation>`, `cancelReservation(r, now): Result<Reservation>`. Test builders: `T0`, `at(offsetMs)`, `HOLD_MS`, `aReservation(overrides)`.

- [ ] **Step 1: Write the test builders**

```ts path=tests/support/builders.ts
import type { Reservation } from '../../src/domain/reservation';

/** A fixed "now" so every test is deterministic. */
export const T0 = new Date('2026-09-22T10:00:00.000Z');

export const HOLD_MS = 120_000;

export function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

export function aReservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: 'res-1',
    sku: 'flash-ticket',
    userId: 'ana',
    quantity: 1,
    state: 'Active',
    createdAt: T0,
    expiresAt: at(HOLD_MS),
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing tests**

```ts path=tests/domain/reservation.test.ts
import { describe, expect, it } from 'vitest';
import {
  cancelReservation,
  confirmReservation,
  expireIfDue,
  isActive,
} from '../../src/domain/reservation';
import { HOLD_MS, T0, aReservation, at } from '../support/builders';

describe('R4 — confirm moves Active to Confirmed', () => {
  it('returns a Confirmed copy and leaves the original untouched', () => {
    const active = aReservation();
    const result = confirmReservation(active, T0);
    expect(result).toEqual({ ok: true, value: { ...active, state: 'Confirmed' } });
    expect(active.state).toBe('Active');
  });
});

describe('R5 — cancel moves Active to Cancelled', () => {
  it('returns a Cancelled copy', () => {
    const result = cancelReservation(aReservation(), T0);
    expect(result).toEqual({ ok: true, value: { ...aReservation(), state: 'Cancelled' } });
  });
});

describe('R6 — a reservation is expired at expiresAt exactly', () => {
  it('is active one millisecond before expiry', () => {
    expect(isActive(aReservation(), at(HOLD_MS - 1))).toBe(true);
  });

  it('is not active at expiry', () => {
    expect(isActive(aReservation(), at(HOLD_MS))).toBe(false);
  });

  it('expireIfDue returns the same object while the hold lasts', () => {
    const active = aReservation();
    expect(expireIfDue(active, at(HOLD_MS - 1))).toBe(active);
  });

  it('expireIfDue returns an Expired copy once due', () => {
    const active = aReservation();
    expect(expireIfDue(active, at(HOLD_MS))).toEqual({ ...active, state: 'Expired' });
  });

  it('expireIfDue leaves non-Active reservations alone even when past expiresAt', () => {
    const confirmed = aReservation({ state: 'Confirmed' });
    expect(expireIfDue(confirmed, at(HOLD_MS + 1))).toBe(confirmed);
  });

  it('confirm one millisecond before expiry succeeds', () => {
    expect(confirmReservation(aReservation(), at(HOLD_MS - 1)).ok).toBe(true);
  });

  it('confirm at expiry fails as Expired', () => {
    const result = confirmReservation(aReservation(), at(HOLD_MS));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('INVALID_STATE');
      expect(result.failure.message).toContain('Expired');
    }
  });
});

describe('R7 — confirm and cancel apply only to Active reservations', () => {
  it.each([
    ['confirm', 'Cancelled', confirmReservation],
    ['confirm', 'Confirmed', confirmReservation],
    ['confirm', 'Expired', confirmReservation],
    ['cancel', 'Confirmed', cancelReservation],
    ['cancel', 'Cancelled', cancelReservation],
    ['cancel', 'Expired', cancelReservation],
  ] as const)(
    '%s on a %s reservation fails with INVALID_STATE naming the state',
    (_verb, state, apply) => {
      const result = apply(aReservation({ state }), T0);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('INVALID_STATE');
        expect(result.failure.message).toContain(state);
      }
    },
  );

  it('confirmed purchases cannot be reversed', () => {
    const confirmed = confirmReservation(aReservation(), T0);
    if (!confirmed.ok) throw new Error('expected confirm to succeed');
    expect(cancelReservation(confirmed.value, T0).ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `npx vitest run tests/domain/reservation.test.ts`
Expected: FAIL — `Cannot find module '../../src/domain/reservation'`

- [ ] **Step 4: Implement**

```ts path=src/domain/reservation.ts
import { fail, ok, type Result } from './failures';
import type { Sku } from './product';

export type ReservationId = string;
export type UserId = string;

export type ReservationState = 'Active' | 'Confirmed' | 'Cancelled' | 'Expired';

export interface Reservation {
  readonly id: ReservationId;
  readonly sku: Sku;
  readonly userId: UserId;
  readonly quantity: number;
  readonly state: ReservationState;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/** Holding stock without having bought it: Active and not yet at `expiresAt`. */
export function isActive(reservation: Reservation, now: Date): boolean {
  return reservation.state === 'Active' && reservation.expiresAt.getTime() > now.getTime();
}

/**
 * Expiry is a fact about time, not an event: an Active reservation at or past `expiresAt` is
 * Expired whether or not anything has recorded it yet. Returns the same object when nothing is
 * due, so callers can detect a transition by identity and save only when one happened.
 */
export function expireIfDue(reservation: Reservation, now: Date): Reservation {
  if (reservation.state !== 'Active' || isActive(reservation, now)) {
    return reservation;
  }
  return { ...reservation, state: 'Expired' };
}

export function confirmReservation(reservation: Reservation, now: Date): Result<Reservation> {
  return transition(reservation, now, 'Confirmed');
}

export function cancelReservation(reservation: Reservation, now: Date): Result<Reservation> {
  return transition(reservation, now, 'Cancelled');
}

function transition(
  reservation: Reservation,
  now: Date,
  to: 'Confirmed' | 'Cancelled',
): Result<Reservation> {
  const current = expireIfDue(reservation, now);
  if (current.state !== 'Active') {
    return fail(
      'INVALID_STATE',
      `Reservation ${current.id} is ${current.state}; only Active reservations can be ${to.toLowerCase()}.`,
    );
  }
  return ok({ ...current, state: to });
}
```

- [ ] **Step 5: Run and watch them pass**

Run: `npx vitest run tests/domain/reservation.test.ts`
Expected: PASS, 16 tests (the `Sku` import resolves in Task 4; until then create `src/domain/product.ts` containing only `export type Sku = string;` — Task 4 replaces it)

- [ ] **Step 6: Commit**

```bash
git add src/domain/reservation.ts src/domain/product.ts tests/domain/reservation.test.ts tests/support/builders.ts
git commit -m "feat: reservation state machine with expiry at the hold boundary"
```

### Task 4: Products and the availability rule

**Files:**
- Create/replace: `src/domain/product.ts`
- Test: `tests/domain/product.test.ts`

**Interfaces:**
- Consumes: `Reservation`, `isActive` from Task 3.
- Produces: `type Sku = string`, `interface Product { sku; name; totalStock }`, `interface ProductView extends Product { confirmed; active; available }`, `stockCounts(product, reservations, now): ProductView`, `available(product, reservations, now): number`.

- [ ] **Step 1: Write the failing tests**

```ts path=tests/domain/product.test.ts
import { describe, expect, it } from 'vitest';
import { available, stockCounts, type Product } from '../../src/domain/product';
import { HOLD_MS, T0, aReservation, at } from '../support/builders';

const ticket: Product = { sku: 'flash-ticket', name: 'Flash Sale Ticket', totalStock: 5 };

describe('R1 — available = total − confirmed − active', () => {
  it('counts confirmed and active reservations against total stock', () => {
    const reservations = [
      aReservation({ id: 'c1', state: 'Confirmed' }),
      aReservation({ id: 'c2', state: 'Confirmed' }),
      aReservation({ id: 'a1', state: 'Active' }),
    ];
    expect(stockCounts(ticket, reservations, T0)).toEqual({
      ...ticket,
      confirmed: 2,
      active: 1,
      available: 2,
    });
  });

  it('sums quantities', () => {
    const reservations = [aReservation({ id: 'a1', quantity: 3 })];
    expect(available(ticket, reservations, T0)).toBe(2);
  });

  it('ignores cancelled reservations', () => {
    expect(available(ticket, [aReservation({ state: 'Cancelled' })], T0)).toBe(5);
  });

  it('ignores expired reservations, recorded or not', () => {
    const reservations = [
      aReservation({ id: 'e1', state: 'Expired' }),
      aReservation({ id: 'e2', state: 'Active' }),
    ];
    expect(available(ticket, reservations, at(HOLD_MS))).toBe(5);
  });

  it('ignores reservations for other products', () => {
    expect(available(ticket, [aReservation({ sku: 'other' })], T0)).toBe(5);
  });

  it('reports zero available when everything is held', () => {
    const reservations = [aReservation({ quantity: 5 })];
    expect(stockCounts(ticket, reservations, T0).available).toBe(0);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/domain/product.test.ts`
Expected: FAIL — `stockCounts` is not exported (the file only has `Sku`)

- [ ] **Step 3: Implement**

```ts path=src/domain/product.ts
import { isActive, type Reservation } from './reservation';

export type Sku = string;

export interface Product {
  readonly sku: Sku;
  readonly name: string;
  readonly totalStock: number;
}

/** A product with the numbers the business rule is made of: available = total − confirmed − active. */
export interface ProductView extends Product {
  readonly confirmed: number;
  readonly active: number;
  readonly available: number;
}

export function stockCounts(
  product: Product,
  reservations: readonly Reservation[],
  now: Date,
): ProductView {
  let confirmed = 0;
  let active = 0;
  for (const reservation of reservations) {
    if (reservation.sku !== product.sku) {
      continue;
    }
    if (reservation.state === 'Confirmed') {
      confirmed += reservation.quantity;
    } else if (isActive(reservation, now)) {
      active += reservation.quantity;
    }
  }
  return { ...product, confirmed, active, available: product.totalStock - confirmed - active };
}

export function available(
  product: Product,
  reservations: readonly Reservation[],
  now: Date,
): number {
  return stockCounts(product, reservations, now).available;
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run tests/domain`
Expected: PASS, 25 tests across 3 files

- [ ] **Step 5: Commit**

```bash
git add src/domain/product.ts tests/domain/product.test.ts
git commit -m "feat: product stock arithmetic (available = total - confirmed - active)"
```

### Task 5: Ports and clocks

**Files:**
- Create: `src/application/ports.ts`, `src/infrastructure/clock.ts`, `tests/support/fake-clock.ts`
- Test: `tests/infrastructure/clock.test.ts`

**Interfaces:**
- Produces: `interface InventoryStore` (7 async methods), `interface LockManager { withLock<T>(key, task): Promise<T> }`, `interface Clock { now(): Date }`, `class SystemClock`, test `class FakeClock { constructor(start); now(); advance(ms); set(to) }`.

- [ ] **Step 1: Write the ports (interfaces only; no test of their own)**

```ts path=src/application/ports.ts
import type { Product, Sku } from '../domain/product';
import type { Reservation, ReservationId } from '../domain/reservation';

/**
 * Storage as the service sees it. Every method returns a promise: this is the seam where a
 * database would go, and it is also what allows concurrent callers to interleave between a read
 * and a write, which is what the lock exists to prevent.
 */
export interface InventoryStore {
  getProduct(sku: Sku): Promise<Product | undefined>;
  saveProduct(product: Product): Promise<void>;
  /** Removes the product and every reservation for it. */
  deleteProduct(sku: Sku): Promise<void>;
  getReservation(id: ReservationId): Promise<Reservation | undefined>;
  saveReservation(reservation: Reservation): Promise<void>;
  listReservations(sku: Sku): Promise<readonly Reservation[]>;
  snapshot(): Promise<{
    readonly products: readonly Product[];
    readonly reservations: readonly Reservation[];
  }>;
}

/** Runs `task` while holding the lock for `key`; tasks with the same key never overlap. */
export interface LockManager {
  withLock<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}
```

- [ ] **Step 2: Write the failing clock tests**

```ts path=tests/support/fake-clock.ts
import type { Clock } from '../../src/application/ports';

export class FakeClock implements Clock {
  #current: Date;

  constructor(start: Date) {
    this.#current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.#current.getTime());
  }

  advance(ms: number): void {
    this.#current = new Date(this.#current.getTime() + ms);
  }

  set(to: Date): void {
    this.#current = new Date(to.getTime());
  }
}
```

```ts path=tests/infrastructure/clock.test.ts
import { describe, expect, it } from 'vitest';
import { SystemClock } from '../../src/infrastructure/clock';
import { T0 } from '../support/builders';
import { FakeClock } from '../support/fake-clock';

describe('SystemClock', () => {
  it('reports the current time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe('FakeClock', () => {
  it('starts where told, advances, and hands out copies', () => {
    const clock = new FakeClock(T0);
    const first = clock.now();
    clock.advance(1_000);
    expect(first.getTime()).toBe(T0.getTime());
    expect(clock.now().getTime()).toBe(T0.getTime() + 1_000);
    clock.set(T0);
    expect(clock.now().getTime()).toBe(T0.getTime());
  });
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `npx vitest run tests/infrastructure/clock.test.ts`
Expected: FAIL — `Cannot find module '../../src/infrastructure/clock'`

- [ ] **Step 4: Implement**

```ts path=src/infrastructure/clock.ts
import type { Clock } from '../application/ports';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
```

- [ ] **Step 5: Run and watch them pass, then lint**

Run: `npx vitest run tests/infrastructure/clock.test.ts && npm run lint && npm run typecheck`
Expected: PASS, 2 tests; lint and typecheck exit 0

- [ ] **Step 6: Commit**

```bash
git add src/application/ports.ts src/infrastructure/clock.ts tests/support/fake-clock.ts tests/infrastructure/clock.test.ts
git commit -m "feat: store, lock and clock ports with a system clock"
```

---

## Phase 2 — Core

### Task 6: The mutex

**Files:**
- Create: `src/infrastructure/mutex.ts`, `tests/support/timing.ts`
- Test: `tests/infrastructure/mutex.test.ts`

**Interfaces:**
- Consumes: `LockManager` from Task 5.
- Produces: `class Mutex { runExclusive<T>(task: () => Promise<T>): Promise<T> }`, `class KeyedMutex implements LockManager`, `class NoLock implements LockManager`. Test helper `tick(): Promise<void>` (yields one macrotask).

- [ ] **Step 1: Write the timing helper and the failing tests**

```ts path=tests/support/timing.ts
/** Lets every other pending callback run before continuing. */
export function tick(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
```

```ts path=tests/infrastructure/mutex.test.ts
import { describe, expect, it } from 'vitest';
import { KeyedMutex, Mutex, NoLock } from '../../src/infrastructure/mutex';
import { tick } from '../support/timing';

/** A task that logs when it starts and ends, with a yield in between so others could interleave. */
function loggingTask(log: string[], name: string): () => Promise<string> {
  return async () => {
    log.push(`${name} start`);
    await tick();
    log.push(`${name} end`);
    return name;
  };
}

describe('Mutex', () => {
  it('runs tasks one at a time, in submission order', async () => {
    const mutex = new Mutex();
    const log: string[] = [];
    const results = await Promise.all([
      mutex.runExclusive(loggingTask(log, 'A')),
      mutex.runExclusive(loggingTask(log, 'B')),
      mutex.runExclusive(loggingTask(log, 'C')),
    ]);
    expect(log).toEqual(['A start', 'A end', 'B start', 'B end', 'C start', 'C end']);
    expect(results).toEqual(['A', 'B', 'C']);
  });

  it('without a mutex the same tasks interleave (control)', async () => {
    const log: string[] = [];
    await Promise.all([loggingTask(log, 'A')(), loggingTask(log, 'B')()]);
    expect(log).toEqual(['A start', 'B start', 'A end', 'B end']);
  });

  it('a task that throws neither blocks the next task nor swallows its error', async () => {
    const mutex = new Mutex();
    const failing = mutex.runExclusive(() => Promise.reject(new Error('boom')));
    const next = mutex.runExclusive(() => Promise.resolve('still running'));
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('still running');
  });
});

describe('KeyedMutex', () => {
  it('serialises tasks that share a key', async () => {
    const locks = new KeyedMutex();
    const log: string[] = [];
    await Promise.all([
      locks.withLock('sku-1', loggingTask(log, 'A')),
      locks.withLock('sku-1', loggingTask(log, 'B')),
    ]);
    expect(log).toEqual(['A start', 'A end', 'B start', 'B end']);
  });

  it('lets tasks with different keys overlap', async () => {
    const locks = new KeyedMutex();
    const log: string[] = [];
    await Promise.all([
      locks.withLock('sku-1', async () => {
        log.push('slow start');
        await tick();
        await tick();
        log.push('slow end');
      }),
      locks.withLock('sku-2', async () => {
        log.push('quick start');
        await tick();
        log.push('quick end');
      }),
    ]);
    expect(log).toEqual(['slow start', 'quick start', 'quick end', 'slow end']);
  });
});

describe('NoLock', () => {
  it('runs tasks immediately, so they interleave', async () => {
    const locks = new NoLock();
    const log: string[] = [];
    await Promise.all([
      locks.withLock('sku-1', loggingTask(log, 'A')),
      locks.withLock('sku-1', loggingTask(log, 'B')),
    ]);
    expect(log).toEqual(['A start', 'B start', 'A end', 'B end']);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/infrastructure/mutex.test.ts`
Expected: FAIL — `Cannot find module '../../src/infrastructure/mutex'`

- [ ] **Step 3: Implement**

```ts path=src/infrastructure/mutex.ts
import type { LockManager } from '../application/ports';

/**
 * A promise-chain mutex. `#tail` stands for the last task in the queue; a new task is chained
 * after it, so tasks run one at a time in submission order. The chain is kept settled-safe
 * (`then(noop, noop)`) so a task that rejects does not block the tasks behind it, while the
 * caller still receives that rejection through the returned promise.
 *
 * Nothing here blocks a thread: "waiting" is a promise that has not resolved yet.
 */
export class Mutex {
  #tail: Promise<void> = Promise.resolve();

  runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(task);
    this.#tail = result.then(noop, noop);
    return result;
  }
}

/** One Mutex per key, created on first use. Tasks with different keys never wait for each other. */
export class KeyedMutex implements LockManager {
  readonly #mutexes = new Map<string, Mutex>();

  withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    let mutex = this.#mutexes.get(key);
    if (mutex === undefined) {
      mutex = new Mutex();
      this.#mutexes.set(key, mutex);
    }
    return mutex.runExclusive(task);
  }
}

/** No locking at all. Exists so tests can show what goes wrong without the lock. */
export class NoLock implements LockManager {
  withLock<T>(_key: string, task: () => Promise<T>): Promise<T> {
    return task();
  }
}

function noop(): void {
  // intentionally empty
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run tests/infrastructure/mutex.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/mutex.ts tests/infrastructure/mutex.test.ts tests/support/timing.ts
git commit -m "feat: promise-chain mutex with one lock per key"
```

### Task 7: In-memory store

**Files:**
- Create: `src/infrastructure/store.ts`
- Test: `tests/infrastructure/store.test.ts`

**Interfaces:**
- Consumes: `InventoryStore` from Task 5.
- Produces: `class InMemoryStore implements InventoryStore`. Reservations are listed in insertion order.

- [ ] **Step 1: Write the failing tests**

```ts path=tests/infrastructure/store.test.ts
import { describe, expect, it } from 'vitest';
import type { Product } from '../../src/domain/product';
import { InMemoryStore } from '../../src/infrastructure/store';
import { aReservation } from '../support/builders';

const ticket: Product = { sku: 'flash-ticket', name: 'Flash Sale Ticket', totalStock: 1 };
const mug: Product = { sku: 'mug', name: 'Mug', totalStock: 10 };

describe('InMemoryStore', () => {
  it('round-trips products', async () => {
    const store = new InMemoryStore();
    expect(await store.getProduct('flash-ticket')).toBeUndefined();
    await store.saveProduct(ticket);
    expect(await store.getProduct('flash-ticket')).toEqual(ticket);
    await store.saveProduct({ ...ticket, totalStock: 3 });
    expect(await store.getProduct('flash-ticket')).toEqual({ ...ticket, totalStock: 3 });
  });

  it('round-trips reservations and lists them per product in insertion order', async () => {
    const store = new InMemoryStore();
    const first = aReservation({ id: 'r1' });
    const second = aReservation({ id: 'r2' });
    const other = aReservation({ id: 'r3', sku: 'mug' });
    await store.saveReservation(second);
    await store.saveReservation(first);
    await store.saveReservation(other);
    expect(await store.getReservation('r1')).toEqual(first);
    expect(await store.getReservation('missing')).toBeUndefined();
    expect(await store.listReservations('flash-ticket')).toEqual([second, first]);
  });

  it('deleting a product removes its reservations only', async () => {
    const store = new InMemoryStore();
    await store.saveProduct(ticket);
    await store.saveProduct(mug);
    await store.saveReservation(aReservation({ id: 'r1' }));
    await store.saveReservation(aReservation({ id: 'r2', sku: 'mug' }));
    await store.deleteProduct('flash-ticket');
    expect(await store.getProduct('flash-ticket')).toBeUndefined();
    expect(await store.getReservation('r1')).toBeUndefined();
    expect(await store.getProduct('mug')).toEqual(mug);
    expect(await store.getReservation('r2')).toBeDefined();
  });

  it('snapshot returns every product and reservation', async () => {
    const store = new InMemoryStore();
    await store.saveProduct(ticket);
    await store.saveProduct(mug);
    await store.saveReservation(aReservation({ id: 'r1' }));
    expect(await store.snapshot()).toEqual({
      products: [ticket, mug],
      reservations: [aReservation({ id: 'r1' })],
    });
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/infrastructure/store.test.ts`
Expected: FAIL — `Cannot find module '../../src/infrastructure/store'`

- [ ] **Step 3: Implement**

```ts path=src/infrastructure/store.ts
import type { InventoryStore } from '../application/ports';
import type { Product, Sku } from '../domain/product';
import type { Reservation, ReservationId } from '../domain/reservation';

/**
 * Two Maps. Methods return promises because the port is asynchronous (see `InventoryStore`);
 * `Promise.resolve` rather than `async` because nothing here awaits.
 */
export class InMemoryStore implements InventoryStore {
  readonly #products = new Map<Sku, Product>();
  readonly #reservations = new Map<ReservationId, Reservation>();

  getProduct(sku: Sku): Promise<Product | undefined> {
    return Promise.resolve(this.#products.get(sku));
  }

  saveProduct(product: Product): Promise<void> {
    this.#products.set(product.sku, product);
    return Promise.resolve();
  }

  deleteProduct(sku: Sku): Promise<void> {
    this.#products.delete(sku);
    for (const [id, reservation] of this.#reservations) {
      if (reservation.sku === sku) {
        this.#reservations.delete(id);
      }
    }
    return Promise.resolve();
  }

  getReservation(id: ReservationId): Promise<Reservation | undefined> {
    return Promise.resolve(this.#reservations.get(id));
  }

  saveReservation(reservation: Reservation): Promise<void> {
    this.#reservations.set(reservation.id, reservation);
    return Promise.resolve();
  }

  listReservations(sku: Sku): Promise<readonly Reservation[]> {
    return Promise.resolve(
      [...this.#reservations.values()].filter((reservation) => reservation.sku === sku),
    );
  }

  snapshot(): Promise<{
    readonly products: readonly Product[];
    readonly reservations: readonly Reservation[];
  }> {
    return Promise.resolve({
      products: [...this.#products.values()],
      reservations: [...this.#reservations.values()],
    });
  }
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run tests/infrastructure/store.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/store.ts tests/infrastructure/store.test.ts
git commit -m "feat: in-memory inventory store"
```

### Task 8: InventoryService — products and snapshot

**Files:**
- Create: `src/application/inventory-service.ts`, `tests/support/service.ts`
- Test: `tests/application/inventory-service.products.test.ts`

**Interfaces:**
- Consumes: Tasks 2–7.
- Produces: `class InventoryService` with `constructor(store, locks, clock, options?: { holdTimeMs?: number })`, `holdTimeMs` getter, `setHoldTime(ms): Result<number>`, `createProduct(input): Promise<Result<ProductView>>`, `adjustStock(sku, totalStock): Promise<Result<ProductView>>`, `deleteProduct(sku): Promise<Result<undefined>>`, `reserve(sku, userId, quantity?)`, `confirm(id)`, `cancel(id)`, `snapshot(): Promise<Snapshot>`; `interface Snapshot { now: Date; holdTimeMs; products: ProductView[]; reservations: Reservation[] }`; `DEFAULT_HOLD_TIME_MS = 120_000`. Test helpers `makeService({ locks?, holdTimeMs? })`, `unwrap(result)`, `unwrapFailure(result)`. The whole class is written here; Task 9 tests the reservation methods.

- [ ] **Step 1: Write the test helpers and the failing tests**

```ts path=tests/support/service.ts
import type { LockManager } from '../../src/application/ports';
import { InventoryService } from '../../src/application/inventory-service';
import type { Failure, Result } from '../../src/domain/failures';
import { KeyedMutex } from '../../src/infrastructure/mutex';
import { InMemoryStore } from '../../src/infrastructure/store';
import { T0 } from './builders';
import { FakeClock } from './fake-clock';

export interface ServiceUnderTest {
  readonly service: InventoryService;
  readonly clock: FakeClock;
  readonly store: InMemoryStore;
}

export function makeService(
  options: { readonly locks?: LockManager; readonly holdTimeMs?: number } = {},
): ServiceUnderTest {
  const clock = new FakeClock(T0);
  const store = new InMemoryStore();
  const service = new InventoryService(
    store,
    options.locks ?? new KeyedMutex(),
    clock,
    options.holdTimeMs === undefined ? {} : { holdTimeMs: options.holdTimeMs },
  );
  return { service, clock, store };
}

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`Expected ok, got ${result.failure.code}: ${result.failure.message}`);
  }
  return result.value;
}

export function unwrapFailure(result: Result<unknown>): Failure {
  if (result.ok) {
    throw new Error('Expected a failure, got ok');
  }
  return result.failure;
}
```

```ts path=tests/application/inventory-service.products.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_HOLD_TIME_MS } from '../../src/application/inventory-service';
import { T0 } from '../support/builders';
import { makeService, unwrap, unwrapFailure } from '../support/service';

const ticket = { sku: 'flash-ticket', name: 'Flash Sale Ticket', totalStock: 1 };

describe('createProduct', () => {
  it('stores the product and reports it with zero counts', async () => {
    const { service } = makeService();
    const view = unwrap(await service.createProduct(ticket));
    expect(view).toEqual({ ...ticket, confirmed: 0, active: 0, available: 1 });
  });

  it('R10 — rejects a duplicate sku with ALREADY_EXISTS', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    expect(unwrapFailure(await service.createProduct(ticket)).code).toBe('ALREADY_EXISTS');
  });

  it.each([
    ['empty sku', { ...ticket, sku: ' ' }],
    ['empty name', { ...ticket, name: '' }],
    ['negative stock', { ...ticket, totalStock: -1 }],
    ['fractional stock', { ...ticket, totalStock: 1.5 }],
  ])('R10 — rejects %s with VALIDATION', async (_label, input) => {
    const { service } = makeService();
    expect(unwrapFailure(await service.createProduct(input)).code).toBe('VALIDATION');
  });
});

describe('adjustStock', () => {
  it('sets the total and recomputes the view', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    unwrap(await service.reserve('flash-ticket', 'ana'));
    const view = unwrap(await service.adjustStock('flash-ticket', 3));
    expect(view).toEqual({ ...ticket, totalStock: 3, confirmed: 0, active: 1, available: 2 });
  });

  it('R10 — rejects an unknown product with NOT_FOUND', async () => {
    const { service } = makeService();
    expect(unwrapFailure(await service.adjustStock('nope', 3)).code).toBe('NOT_FOUND');
  });

  it('R10 — rejects a total below confirmed + active with VALIDATION', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct({ ...ticket, totalStock: 3 }));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    unwrap(await service.confirm(held.id));
    unwrap(await service.reserve('flash-ticket', 'ben'));
    const failure = unwrapFailure(await service.adjustStock('flash-ticket', 1));
    expect(failure.code).toBe('VALIDATION');
    expect(failure.message).toContain('1 confirmed and 1 active');
    expect(unwrap(await service.adjustStock('flash-ticket', 2)).available).toBe(0);
  });

  it('R10 — rejects a negative or fractional total with VALIDATION', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    expect(unwrapFailure(await service.adjustStock('flash-ticket', -1)).code).toBe('VALIDATION');
    expect(unwrapFailure(await service.adjustStock('flash-ticket', 0.5)).code).toBe('VALIDATION');
  });
});

describe('deleteProduct', () => {
  it('removes the product and its reservations', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    unwrap(await service.deleteProduct('flash-ticket'));
    expect(unwrapFailure(await service.confirm(held.id)).code).toBe('NOT_FOUND');
    expect((await service.snapshot()).products).toEqual([]);
  });

  it('R10 — rejects an unknown product with NOT_FOUND', async () => {
    const { service } = makeService();
    expect(unwrapFailure(await service.deleteProduct('nope')).code).toBe('NOT_FOUND');
  });
});

describe('snapshot', () => {
  it('reports now, hold time, every product view and every reservation', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    unwrap(await service.createProduct({ sku: 'mug', name: 'Mug', totalStock: 2 }));
    const held = unwrap(await service.reserve('mug', 'ana'));
    const snapshot = await service.snapshot();
    expect(snapshot.now).toEqual(T0);
    expect(snapshot.holdTimeMs).toBe(DEFAULT_HOLD_TIME_MS);
    expect(snapshot.products).toEqual([
      { ...ticket, confirmed: 0, active: 0, available: 1 },
      { sku: 'mug', name: 'Mug', totalStock: 2, confirmed: 0, active: 1, available: 1 },
    ]);
    expect(snapshot.reservations).toEqual([held]);
  });
});

describe('hold time', () => {
  it('R8 — defaults to 120 000 ms and can be set per instance', () => {
    expect(makeService().service.holdTimeMs).toBe(120_000);
    expect(makeService({ holdTimeMs: 10_000 }).service.holdTimeMs).toBe(10_000);
  });

  it('R8 — setHoldTime changes it at runtime', () => {
    const { service } = makeService();
    expect(service.setHoldTime(5_000)).toEqual({ ok: true, value: 5_000 });
    expect(service.holdTimeMs).toBe(5_000);
  });

  it('R10 — setHoldTime rejects anything but a positive integer', () => {
    const { service } = makeService();
    expect(unwrapFailure(service.setHoldTime(0)).code).toBe('VALIDATION');
    expect(unwrapFailure(service.setHoldTime(-1)).code).toBe('VALIDATION');
    expect(unwrapFailure(service.setHoldTime(1.5)).code).toBe('VALIDATION');
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/application/inventory-service.products.test.ts`
Expected: FAIL — `Cannot find module '../../src/application/inventory-service'`

- [ ] **Step 3: Implement the whole service**

```ts path=src/application/inventory-service.ts
import { fail, ok, type Fail, type Result } from '../domain/failures';
import {
  available,
  stockCounts,
  type Product,
  type ProductView,
  type Sku,
} from '../domain/product';
import {
  cancelReservation,
  confirmReservation,
  expireIfDue,
  type Reservation,
  type ReservationId,
  type UserId,
} from '../domain/reservation';
import type { Clock, InventoryStore, LockManager } from './ports';

/** The brief's hold time: two minutes. */
export const DEFAULT_HOLD_TIME_MS = 120_000;

export interface CreateProductInput {
  readonly sku: Sku;
  readonly name: string;
  readonly totalStock: number;
}

export interface Snapshot {
  readonly now: Date;
  readonly holdTimeMs: number;
  readonly products: readonly ProductView[];
  /** Reservations with their effective state: overdue Active ones are shown as Expired. */
  readonly reservations: readonly Reservation[];
}

interface LoadedProduct {
  readonly product: Product;
  readonly reservations: readonly Reservation[];
}

/**
 * Every write is `withLock(sku, load → decide → save)`: the only place a lock is taken.
 * Deciding is done by pure domain functions; this class only sequences I/O around them.
 */
export class InventoryService {
  readonly #store: InventoryStore;
  readonly #locks: LockManager;
  readonly #clock: Clock;
  #holdTimeMs: number;

  constructor(
    store: InventoryStore,
    locks: LockManager,
    clock: Clock,
    options: { readonly holdTimeMs?: number } = {},
  ) {
    this.#store = store;
    this.#locks = locks;
    this.#clock = clock;
    this.#holdTimeMs = options.holdTimeMs ?? DEFAULT_HOLD_TIME_MS;
  }

  get holdTimeMs(): number {
    return this.#holdTimeMs;
  }

  /** Applies to reservations made from now on; existing ones keep their `expiresAt`. */
  setHoldTime(ms: number): Result<number> {
    if (!isPositiveInteger(ms)) {
      return fail('VALIDATION', 'Hold time must be a positive integer of milliseconds.');
    }
    this.#holdTimeMs = ms;
    return ok(ms);
  }

  createProduct(input: CreateProductInput): Promise<Result<ProductView>> {
    if (input.sku.trim() === '' || input.name.trim() === '') {
      return Promise.resolve(fail('VALIDATION', 'Product sku and name must not be empty.'));
    }
    if (!isNonNegativeInteger(input.totalStock)) {
      return Promise.resolve(fail('VALIDATION', 'Total stock must be a non-negative integer.'));
    }
    return this.#locks.withLock(input.sku, async () => {
      if ((await this.#store.getProduct(input.sku)) !== undefined) {
        return fail('ALREADY_EXISTS', `Product ${input.sku} already exists.`);
      }
      const product: Product = { sku: input.sku, name: input.name, totalStock: input.totalStock };
      await this.#store.saveProduct(product);
      return ok(stockCounts(product, [], this.#clock.now()));
    });
  }

  adjustStock(sku: Sku, totalStock: number): Promise<Result<ProductView>> {
    if (!isNonNegativeInteger(totalStock)) {
      return Promise.resolve(fail('VALIDATION', 'Total stock must be a non-negative integer.'));
    }
    return this.#locks.withLock(sku, async () => {
      const now = this.#clock.now();
      const loaded = await this.#load(sku, now);
      if (loaded === undefined) {
        return productNotFound(sku);
      }
      const counts = stockCounts(loaded.product, loaded.reservations, now);
      const floor = counts.confirmed + counts.active;
      if (totalStock < floor) {
        return fail(
          'VALIDATION',
          `Total stock cannot go below ${String(floor)}: ${String(counts.confirmed)} confirmed and ${String(counts.active)} active.`,
        );
      }
      const product: Product = { ...loaded.product, totalStock };
      await this.#store.saveProduct(product);
      return ok(stockCounts(product, loaded.reservations, now));
    });
  }

  deleteProduct(sku: Sku): Promise<Result<undefined>> {
    return this.#locks.withLock(sku, async () => {
      if ((await this.#store.getProduct(sku)) === undefined) {
        return productNotFound(sku);
      }
      await this.#store.deleteProduct(sku);
      return ok(undefined);
    });
  }

  reserve(sku: Sku, userId: UserId, quantity = 1): Promise<Result<Reservation>> {
    if (userId.trim() === '') {
      return Promise.resolve(fail('VALIDATION', 'User id must not be empty.'));
    }
    if (!isPositiveInteger(quantity)) {
      return Promise.resolve(fail('VALIDATION', 'Quantity must be a positive integer.'));
    }
    return this.#locks.withLock(sku, async () => {
      const now = this.#clock.now();
      const loaded = await this.#load(sku, now);
      if (loaded === undefined) {
        return productNotFound(sku);
      }
      const free = available(loaded.product, loaded.reservations, now);
      if (quantity > free) {
        return fail(
          'OUT_OF_STOCK',
          `Only ${String(free)} of ${sku} available; ${String(quantity)} requested.`,
        );
      }
      const reservation: Reservation = {
        id: crypto.randomUUID(),
        sku,
        userId,
        quantity,
        state: 'Active',
        createdAt: now,
        expiresAt: new Date(now.getTime() + this.#holdTimeMs),
      };
      await this.#store.saveReservation(reservation);
      return ok(reservation);
    });
  }

  confirm(id: ReservationId): Promise<Result<Reservation>> {
    return this.#transition(id, confirmReservation);
  }

  cancel(id: ReservationId): Promise<Result<Reservation>> {
    return this.#transition(id, cancelReservation);
  }

  /** A read: takes no lock. One store call, so the view is consistent. */
  async snapshot(): Promise<Snapshot> {
    const now = this.#clock.now();
    const { products, reservations } = await this.#store.snapshot();
    const effective = reservations.map((reservation) => expireIfDue(reservation, now));
    return {
      now,
      holdTimeMs: this.#holdTimeMs,
      products: products.map((product) => stockCounts(product, effective, now)),
      reservations: effective,
    };
  }

  /**
   * Looks the reservation up to learn which product's lock to take, then reloads it inside the
   * lock: another caller may have changed it while this one waited.
   */
  async #transition(
    id: ReservationId,
    apply: (reservation: Reservation, now: Date) => Result<Reservation>,
  ): Promise<Result<Reservation>> {
    const found = await this.#store.getReservation(id);
    if (found === undefined) {
      return reservationNotFound(id);
    }
    return this.#locks.withLock(found.sku, async () => {
      const now = this.#clock.now();
      const current = await this.#store.getReservation(id);
      if (current === undefined) {
        return reservationNotFound(id);
      }
      const result = apply(current, now);
      const next = result.ok ? result.value : expireIfDue(current, now);
      if (next !== current) {
        await this.#store.saveReservation(next);
      }
      return result;
    });
  }

  /** Loads a product and its reservations, recording any expiry that has become due. */
  async #load(sku: Sku, now: Date): Promise<LoadedProduct | undefined> {
    const product = await this.#store.getProduct(sku);
    if (product === undefined) {
      return undefined;
    }
    const reservations: Reservation[] = [];
    for (const stored of await this.#store.listReservations(sku)) {
      const current = expireIfDue(stored, now);
      if (current !== stored) {
        await this.#store.saveReservation(current);
      }
      reservations.push(current);
    }
    return { product, reservations };
  }
}

function productNotFound(sku: Sku): Fail {
  return fail('NOT_FOUND', `Product ${sku} does not exist.`);
}

function reservationNotFound(id: ReservationId): Fail {
  return fail('NOT_FOUND', `Reservation ${id} does not exist.`);
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run tests/application/inventory-service.products.test.ts && npm run lint`
Expected: PASS, 16 tests; lint exit 0

- [ ] **Step 5: Commit**

```bash
git add src/application/inventory-service.ts tests/support/service.ts tests/application/inventory-service.products.test.ts
git commit -m "feat: inventory service with per-product locking around every write"
```

### Task 9: InventoryService — reservation lifecycle

**Files:**
- Test: `tests/application/inventory-service.reservations.test.ts`

**Interfaces:**
- Consumes: Task 8. No production code changes are expected; if a test fails, fix the service and note it in the journal.

- [ ] **Step 1: Write the tests**

```ts path=tests/application/inventory-service.reservations.test.ts
import { describe, expect, it } from 'vitest';
import { HOLD_MS, T0, at } from '../support/builders';
import { makeService, unwrap, unwrapFailure } from '../support/service';

const ticket = { sku: 'flash-ticket', name: 'Flash Sale Ticket', totalStock: 1 };
const mugs = { sku: 'mug', name: 'Mug', totalStock: 2 };

describe('R2 — reserve succeeds only when quantity ≤ available', () => {
  it('creates an Active reservation that expires one hold time from now', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    const reservation = unwrap(await service.reserve('flash-ticket', 'ana'));
    expect(reservation).toMatchObject({
      sku: 'flash-ticket',
      userId: 'ana',
      quantity: 1,
      state: 'Active',
      createdAt: T0,
      expiresAt: at(HOLD_MS),
    });
    expect(reservation.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reserves exactly the available quantity, and no more', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(mugs));
    expect((await service.reserve('mug', 'ana', 3)).ok).toBe(false);
    expect(unwrap(await service.reserve('mug', 'ana', 2)).quantity).toBe(2);
  });

  it('the brief: stock 1, User A succeeds and User B fails', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    expect((await service.reserve('flash-ticket', 'user-a')).ok).toBe(true);
    const failure = unwrapFailure(await service.reserve('flash-ticket', 'user-b'));
    expect(failure.code).toBe('OUT_OF_STOCK');
    expect(failure.message).toBe('Only 0 of flash-ticket available; 1 requested.');
  });
});

describe('R3 — a failed reserve changes nothing', () => {
  it('leaves availability and the reservation list untouched', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    unwrap(await service.reserve('flash-ticket', 'ana'));
    expect((await service.reserve('flash-ticket', 'ben')).ok).toBe(false);
    const snapshot = await service.snapshot();
    expect(snapshot.products[0]?.available).toBe(0);
    expect(snapshot.reservations).toHaveLength(1);
  });
});

describe('R4 — confirm sells the units for good', () => {
  it('keeps availability down and refuses a later cancel', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    expect(unwrap(await service.confirm(held.id)).state).toBe('Confirmed');
    expect((await service.snapshot()).products[0]).toMatchObject({ confirmed: 1, available: 0 });
    expect(unwrapFailure(await service.cancel(held.id)).code).toBe('INVALID_STATE');
  });
});

describe('R5 — cancel releases the units at once', () => {
  it('raises availability by the reserved quantity', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(mugs));
    const held = unwrap(await service.reserve('mug', 'ana', 2));
    expect((await service.snapshot()).products[0]?.available).toBe(0);
    expect(unwrap(await service.cancel(held.id)).state).toBe('Cancelled');
    expect((await service.snapshot()).products[0]?.available).toBe(2);
  });
});

describe('R6 — expiry releases the units and blocks confirm', () => {
  it('holds at t+119 999 ms and releases at t+120 000 ms', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    clock.advance(HOLD_MS - 1);
    expect((await service.snapshot()).products[0]?.available).toBe(0);
    clock.advance(1);
    expect((await service.snapshot()).products[0]?.available).toBe(1);
    const failure = unwrapFailure(await service.confirm(held.id));
    expect(failure.code).toBe('INVALID_STATE');
    expect(failure.message).toContain('Expired');
  });

  it('confirm at t+119 999 ms still succeeds', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    clock.advance(HOLD_MS - 1);
    expect(unwrap(await service.confirm(held.id)).state).toBe('Confirmed');
  });

  it('another user can reserve the item once the hold has expired', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct(ticket));
    unwrap(await service.reserve('flash-ticket', 'ana'));
    clock.advance(HOLD_MS);
    expect(unwrap(await service.reserve('flash-ticket', 'ben')).userId).toBe('ben');
  });

  it('snapshot shows an overdue reservation as Expired before any write records it', async () => {
    const { service, clock, store } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    clock.advance(HOLD_MS);
    expect((await service.snapshot()).reservations[0]?.state).toBe('Expired');
    expect((await store.getReservation(held.id))?.state).toBe('Active');
  });

  it('the next write to the product records the expiry', async () => {
    const { service, clock, store } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    clock.advance(HOLD_MS);
    unwrap(await service.reserve('flash-ticket', 'ben'));
    expect((await store.getReservation(held.id))?.state).toBe('Expired');
  });

  it('a failed confirm on an overdue reservation also records the expiry', async () => {
    const { service, clock, store } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    clock.advance(HOLD_MS);
    expect((await service.confirm(held.id)).ok).toBe(false);
    expect((await store.getReservation(held.id))?.state).toBe('Expired');
  });
});

describe('R7 — confirm and cancel need an Active reservation', () => {
  it('confirm twice fails the second time', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    unwrap(await service.confirm(held.id));
    const failure = unwrapFailure(await service.confirm(held.id));
    expect(failure.code).toBe('INVALID_STATE');
    expect(failure.message).toContain('Confirmed');
  });

  it('cancel after cancel fails', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    unwrap(await service.cancel(held.id));
    expect(unwrapFailure(await service.cancel(held.id)).message).toContain('Cancelled');
  });
});

describe('R8 — hold time applies to new reservations only', () => {
  it('a shorter hold time does not shorten an existing reservation', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct(mugs));
    const first = unwrap(await service.reserve('mug', 'ana'));
    unwrap(service.setHoldTime(10_000));
    const second = unwrap(await service.reserve('mug', 'ben'));
    expect(first.expiresAt).toEqual(at(HOLD_MS));
    expect(second.expiresAt).toEqual(at(10_000));
    clock.advance(10_000);
    expect((await service.snapshot()).products[0]).toMatchObject({ active: 1, available: 1 });
  });
});

describe('R10 — validation', () => {
  it('rejects an unknown product with NOT_FOUND', async () => {
    const { service } = makeService();
    expect(unwrapFailure(await service.reserve('nope', 'ana')).code).toBe('NOT_FOUND');
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects quantity %s with VALIDATION', async (quantity) => {
    const { service } = makeService();
    unwrap(await service.createProduct(mugs));
    expect(unwrapFailure(await service.reserve('mug', 'ana', quantity)).code).toBe('VALIDATION');
  });

  it('rejects an empty user id with VALIDATION', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(mugs));
    expect(unwrapFailure(await service.reserve('mug', '  ')).code).toBe('VALIDATION');
  });

  it('confirm and cancel of an unknown reservation fail with NOT_FOUND', async () => {
    const { service } = makeService();
    expect(unwrapFailure(await service.confirm('nope')).code).toBe('NOT_FOUND');
    expect(unwrapFailure(await service.cancel('nope')).code).toBe('NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run tests/application`
Expected: PASS, 38 tests in 2 files. Every test here exercises code written in Task 8; a failure means the service is wrong, not the test — fix the service, then record the fix in the journal.

- [ ] **Step 3: Commit**

```bash
git add tests/application/inventory-service.reservations.test.ts
git commit -m "test: reservation lifecycle, expiry boundary and validation (R2-R8, R10)"
```

### Task 10: Concurrency tests (R9)

**Files:**
- Test: `tests/application/inventory-service.concurrency.test.ts`

**Interfaces:**
- Consumes: `makeService`, `NoLock`, `Fail` type.

- [ ] **Step 1: Write the tests**

```ts path=tests/application/inventory-service.concurrency.test.ts
import { describe, expect, it } from 'vitest';
import type { Fail, Ok } from '../../src/domain/failures';
import type { Reservation } from '../../src/domain/reservation';
import { NoLock } from '../../src/infrastructure/mutex';
import { makeService, unwrap } from '../support/service';

const REQUESTS = 500;

const isOk = (result: Ok<Reservation> | Fail): result is Ok<Reservation> => result.ok;
const isFail = (result: Ok<Reservation> | Fail): result is Fail => !result.ok;

describe('R9 — only one user gets the last item', () => {
  it('stock 1, 500 simultaneous reserves: exactly 1 succeeds and 499 are OUT_OF_STOCK', async () => {
    const { service } = makeService();
    unwrap(
      await service.createProduct({
        sku: 'flash-ticket',
        name: 'Flash Sale Ticket',
        totalStock: 1,
      }),
    );

    const results = await Promise.all(
      Array.from({ length: REQUESTS }, (_, i) =>
        service.reserve('flash-ticket', `user-${String(i)}`),
      ),
    );

    const successes = results.filter(isOk);
    const failures = results.filter(isFail);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(REQUESTS - 1);
    expect(new Set(failures.map((failure) => failure.failure.code))).toEqual(
      new Set(['OUT_OF_STOCK']),
    );

    const snapshot = await service.snapshot();
    expect(snapshot.products[0]).toMatchObject({ active: 1, available: 0 });
    expect(snapshot.reservations).toHaveLength(1);
  });

  it('WITHOUT the lock the same load oversells: this is why the lock exists', async () => {
    const { service } = makeService({ locks: new NoLock() });
    unwrap(
      await service.createProduct({
        sku: 'flash-ticket',
        name: 'Flash Sale Ticket',
        totalStock: 1,
      }),
    );

    const results = await Promise.all(
      Array.from({ length: REQUESTS }, (_, i) =>
        service.reserve('flash-ticket', `user-${String(i)}`),
      ),
    );

    expect(results.filter(isOk).length).toBeGreaterThan(1);
    expect((await service.snapshot()).products[0]?.available).toBeLessThan(0);
  });

  it('a mixed load of reserve, confirm and cancel on two products never breaks confirmed + active ≤ total', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct({ sku: 'a', name: 'A', totalStock: 10 }));
    unwrap(await service.createProduct({ sku: 'b', name: 'B', totalStock: 10 }));

    const operations = Array.from({ length: 300 }, (_, i) => {
      const sku = i % 2 === 0 ? 'a' : 'b';
      const quantity = (i % 3) + 1;
      return service.reserve(sku, `user-${String(i)}`, quantity).then(async (result) => {
        if (!result.ok) {
          return;
        }
        if (i % 3 === 0) {
          await service.confirm(result.value.id);
        } else if (i % 3 === 1) {
          await service.cancel(result.value.id);
        }
      });
    });
    await Promise.all(operations);

    const snapshot = await service.snapshot();
    for (const product of snapshot.products) {
      const confirmed = snapshot.reservations
        .filter((r) => r.sku === product.sku && r.state === 'Confirmed')
        .reduce((sum, r) => sum + r.quantity, 0);
      const active = snapshot.reservations
        .filter((r) => r.sku === product.sku && r.state === 'Active')
        .reduce((sum, r) => sum + r.quantity, 0);
      expect(product.confirmed).toBe(confirmed);
      expect(product.active).toBe(active);
      expect(product.confirmed + product.active).toBeLessThanOrEqual(product.totalStock);
      expect(product.available).toBeGreaterThanOrEqual(0);
      expect(product.confirmed + product.active).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run tests/application/inventory-service.concurrency.test.ts`
Expected: PASS, 3 tests. The second test **must** pass too: if it fails because the no-lock run sold exactly 1, the store is no longer yielding between read and write, and the whole locking story is hollow. Investigate before going on.

- [ ] **Step 3: Mutation check (do this once, do not commit it)**

Temporarily change `KeyedMutex.withLock` to `return task();`, run the file, and confirm the first test now fails with more than one success. Restore the file, run again, confirm PASS. Record in the journal that the test was seen to fail when the lock was removed.

- [ ] **Step 4: Full suite, lint, typecheck**

Run: `npm test && npm run lint && npm run typecheck`
Expected: 78 tests passing across 9 files; lint and typecheck exit 0

- [ ] **Step 5: Commit**

```bash
git add tests/application/inventory-service.concurrency.test.ts
git commit -m "test: 500 concurrent reserves sell exactly one; no lock oversells (R9)"
```

---

## Phase 3 — HTTP API

### Task 11: Request guards

**Files:**
- Create: `src/http/guards.ts`
- Test: `tests/http/guards.test.ts`

**Interfaces:**
- Consumes: `Result`, `ok`, `fail`.
- Produces: `parseCreateProduct(value: unknown): Result<CreateProductBody>`, `parseAdjustStock(value): Result<AdjustStockBody>`, `parseReserve(value): Result<ReserveBody>` (quantity defaults to 1), `parseHoldTime(value): Result<HoldTimeBody>`. Guards check shape and JSON types only; business rules stay in the service.

- [ ] **Step 1: Write the failing tests**

```ts path=tests/http/guards.test.ts
import { describe, expect, it } from 'vitest';
import {
  parseAdjustStock,
  parseCreateProduct,
  parseHoldTime,
  parseReserve,
} from '../../src/http/guards';
import { unwrapFailure } from '../support/service';

describe('parseCreateProduct', () => {
  it('accepts sku, name and totalStock', () => {
    expect(parseCreateProduct({ sku: 'mug', name: 'Mug', totalStock: 3 })).toEqual({
      ok: true,
      value: { sku: 'mug', name: 'Mug', totalStock: 3 },
    });
  });

  it.each([
    ['not an object', 'mug', 'Request body must be a JSON object.'],
    ['null', null, 'Request body must be a JSON object.'],
    ['an array', [], 'Request body must be a JSON object.'],
    ['a missing sku', { name: 'Mug', totalStock: 3 }, '"sku" must be a string.'],
    ['a numeric name', { sku: 'mug', name: 3, totalStock: 3 }, '"name" must be a string.'],
    [
      'a string totalStock',
      { sku: 'mug', name: 'Mug', totalStock: '3' },
      '"totalStock" must be a number.',
    ],
  ])('rejects %s with VALIDATION', (_label, body, message) => {
    const failure = unwrapFailure(parseCreateProduct(body));
    expect(failure.code).toBe('VALIDATION');
    expect(failure.message).toBe(message);
  });
});

describe('parseAdjustStock', () => {
  it('accepts totalStock', () => {
    expect(parseAdjustStock({ totalStock: 0 })).toEqual({ ok: true, value: { totalStock: 0 } });
  });

  it('rejects a missing totalStock', () => {
    expect(unwrapFailure(parseAdjustStock({})).message).toBe('"totalStock" must be a number.');
  });
});

describe('parseReserve', () => {
  it('accepts userId and quantity', () => {
    expect(parseReserve({ userId: 'ana', quantity: 2 })).toEqual({
      ok: true,
      value: { userId: 'ana', quantity: 2 },
    });
  });

  it('defaults quantity to 1', () => {
    expect(parseReserve({ userId: 'ana' })).toEqual({
      ok: true,
      value: { userId: 'ana', quantity: 1 },
    });
  });

  it('rejects a missing userId', () => {
    expect(unwrapFailure(parseReserve({})).message).toBe('"userId" must be a string.');
  });

  it('rejects a non-numeric quantity', () => {
    expect(unwrapFailure(parseReserve({ userId: 'ana', quantity: 'two' })).message).toBe(
      '"quantity" must be a number.',
    );
  });
});

describe('parseHoldTime', () => {
  it('accepts holdTimeMs', () => {
    expect(parseHoldTime({ holdTimeMs: 10_000 })).toEqual({
      ok: true,
      value: { holdTimeMs: 10_000 },
    });
  });

  it('rejects a missing holdTimeMs', () => {
    expect(unwrapFailure(parseHoldTime({})).message).toBe('"holdTimeMs" must be a number.');
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/http/guards.test.ts`
Expected: FAIL — `Cannot find module '../../src/http/guards'`

- [ ] **Step 3: Implement**

```ts path=src/http/guards.ts
import { fail, ok, type Result } from '../domain/failures';

export interface CreateProductBody {
  readonly sku: string;
  readonly name: string;
  readonly totalStock: number;
}

export interface AdjustStockBody {
  readonly totalStock: number;
}

export interface ReserveBody {
  readonly userId: string;
  readonly quantity: number;
}

export interface HoldTimeBody {
  readonly holdTimeMs: number;
}

/**
 * The edge where `unknown` becomes typed. These check JSON shape only (is it an object, is the
 * field a string or a number); the service applies the business rules.
 */
export function parseCreateProduct(value: unknown): Result<CreateProductBody> {
  const record = asRecord(value);
  if (!record.ok) {
    return record;
  }
  const sku = readString(record.value, 'sku');
  if (!sku.ok) {
    return sku;
  }
  const name = readString(record.value, 'name');
  if (!name.ok) {
    return name;
  }
  const totalStock = readNumber(record.value, 'totalStock');
  if (!totalStock.ok) {
    return totalStock;
  }
  return ok({ sku: sku.value, name: name.value, totalStock: totalStock.value });
}

export function parseAdjustStock(value: unknown): Result<AdjustStockBody> {
  const record = asRecord(value);
  if (!record.ok) {
    return record;
  }
  const totalStock = readNumber(record.value, 'totalStock');
  if (!totalStock.ok) {
    return totalStock;
  }
  return ok({ totalStock: totalStock.value });
}

export function parseReserve(value: unknown): Result<ReserveBody> {
  const record = asRecord(value);
  if (!record.ok) {
    return record;
  }
  const userId = readString(record.value, 'userId');
  if (!userId.ok) {
    return userId;
  }
  if (record.value.quantity === undefined) {
    return ok({ userId: userId.value, quantity: 1 });
  }
  const quantity = readNumber(record.value, 'quantity');
  if (!quantity.ok) {
    return quantity;
  }
  return ok({ userId: userId.value, quantity: quantity.value });
}

export function parseHoldTime(value: unknown): Result<HoldTimeBody> {
  const record = asRecord(value);
  if (!record.ok) {
    return record;
  }
  const holdTimeMs = readNumber(record.value, 'holdTimeMs');
  if (!holdTimeMs.ok) {
    return holdTimeMs;
  }
  return ok({ holdTimeMs: holdTimeMs.value });
}

function asRecord(value: unknown): Result<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('VALIDATION', 'Request body must be a JSON object.');
  }
  return ok(value as Record<string, unknown>);
}

function readString(record: Record<string, unknown>, key: string): Result<string> {
  const value = record[key];
  return typeof value === 'string' ? ok(value) : fail('VALIDATION', `"${key}" must be a string.`);
}

function readNumber(record: Record<string, unknown>, key: string): Result<number> {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? ok(value)
    : fail('VALIDATION', `"${key}" must be a number.`);
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run tests/http/guards.test.ts && npm run lint`
Expected: PASS, 15 tests; lint exit 0. The `value as Record<string, unknown>` assertion stays: an `object` that is not null and not an array is exactly what a JSON object is, and this is the one assertion at the edge.

- [ ] **Step 5: Commit**

```bash
git add src/http/guards.ts tests/http/guards.test.ts
git commit -m "feat: request body guards that turn unknown JSON into typed input"
```

### Task 12: Routes

**Files:**
- Create: `src/http/app.ts`
- Test: `tests/http/app.test.ts`

**Interfaces:**
- Consumes: `InventoryService`, the guards, `FailureCode`, `Result`.
- Produces: `createApp(service: InventoryService): Hono` with the eight routes from spec §7 and a JSON 404 for unknown routes. Dates serialise as ISO strings (JSON.stringify calls `Date#toJSON`).

- [ ] **Step 1: Write the failing tests**

```ts path=tests/http/app.test.ts
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/http/app';
import { HOLD_MS, at } from '../support/builders';
import { makeService, type ServiceUnderTest } from '../support/service';

interface Response<T> {
  readonly status: number;
  readonly body: T;
}

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

async function call<T>(
  app: Hono,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response<T>> {
  const response = await app.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: (text === '' ? undefined : JSON.parse(text)) as T };
}

function setup(): ServiceUnderTest & { app: Hono } {
  const sut = makeService();
  return { ...sut, app: createApp(sut.service) };
}

const ticket = { sku: 'flash-ticket', name: 'Flash Sale Ticket', totalStock: 1 };

describe('R11 — POST /api/products', () => {
  it('creates a product: 201 with its view', async () => {
    const { app } = setup();
    const response = await call<unknown>(app, 'POST', '/api/products', ticket);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ...ticket, confirmed: 0, active: 0, available: 1 });
  });

  it('duplicate sku: 409 ALREADY_EXISTS', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    const response = await call<ErrorBody>(app, 'POST', '/api/products', ticket);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ALREADY_EXISTS');
  });

  it('bad shape: 400 VALIDATION', async () => {
    const { app } = setup();
    const response = await call<ErrorBody>(app, 'POST', '/api/products', { sku: 'x' });
    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION',
      message: '"name" must be a string.',
    });
  });

  it('malformed JSON: 400 VALIDATION', async () => {
    const { app } = setup();
    const response = await app.request('/api/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(response.status).toBe(400);
  });
});

describe('R11 — PATCH and DELETE /api/products/:sku', () => {
  it('PATCH sets the total: 200 with the view', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    const response = await call<unknown>(app, 'PATCH', '/api/products/flash-ticket', {
      totalStock: 4,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ...ticket,
      totalStock: 4,
      confirmed: 0,
      active: 0,
      available: 4,
    });
  });

  it('PATCH unknown sku: 404', async () => {
    const { app } = setup();
    const response = await call<ErrorBody>(app, 'PATCH', '/api/products/nope', { totalStock: 4 });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('PATCH below the floor: 400', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    await call(app, 'POST', '/api/products/flash-ticket/reservations', { userId: 'ana' });
    const response = await call<ErrorBody>(app, 'PATCH', '/api/products/flash-ticket', {
      totalStock: 0,
    });
    expect(response.status).toBe(400);
  });

  it('DELETE: 204 with no body, then 404', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    const first = await call<undefined>(app, 'DELETE', '/api/products/flash-ticket');
    expect(first.status).toBe(204);
    expect(first.body).toBeUndefined();
    expect((await call(app, 'DELETE', '/api/products/flash-ticket')).status).toBe(404);
  });
});

describe('R11 — POST /api/products/:sku/reservations', () => {
  it('reserves: 201 with the reservation, dates as ISO strings', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    const response = await call<{ state: string; expiresAt: string; quantity: number }>(
      app,
      'POST',
      '/api/products/flash-ticket/reservations',
      { userId: 'ana' },
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      sku: 'flash-ticket',
      userId: 'ana',
      quantity: 1,
      state: 'Active',
      expiresAt: at(HOLD_MS).toISOString(),
    });
  });

  it('sold out: 409 OUT_OF_STOCK', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    await call(app, 'POST', '/api/products/flash-ticket/reservations', { userId: 'ana' });
    const response = await call<ErrorBody>(app, 'POST', '/api/products/flash-ticket/reservations', {
      userId: 'ben',
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('OUT_OF_STOCK');
  });

  it('unknown product: 404', async () => {
    const { app } = setup();
    const response = await call(app, 'POST', '/api/products/nope/reservations', { userId: 'ana' });
    expect(response.status).toBe(404);
  });

  it('missing userId: 400', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    const response = await call(app, 'POST', '/api/products/flash-ticket/reservations', {});
    expect(response.status).toBe(400);
  });

  it('R9 over HTTP — 500 concurrent requests for the last item: one 201, 499 × 409', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    const responses = await Promise.all(
      Array.from({ length: 500 }, (_, i) =>
        call<ErrorBody>(app, 'POST', '/api/products/flash-ticket/reservations', {
          userId: `user-${String(i)}`,
        }),
      ),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(499);
  });
});

describe('R11 — POST /api/reservations/:id/confirm and /cancel', () => {
  async function reserved(app: Hono): Promise<string> {
    await call(app, 'POST', '/api/products', ticket);
    const response = await call<{ id: string }>(
      app,
      'POST',
      '/api/products/flash-ticket/reservations',
      {
        userId: 'ana',
      },
    );
    return response.body.id;
  }

  it('confirm: 200 Confirmed, then 409 INVALID_STATE', async () => {
    const { app } = setup();
    const id = await reserved(app);
    const first = await call<{ state: string }>(app, 'POST', `/api/reservations/${id}/confirm`);
    expect(first.status).toBe(200);
    expect(first.body.state).toBe('Confirmed');
    const second = await call<ErrorBody>(app, 'POST', `/api/reservations/${id}/confirm`);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('INVALID_STATE');
  });

  it('cancel: 200 Cancelled', async () => {
    const { app } = setup();
    const id = await reserved(app);
    const response = await call<{ state: string }>(app, 'POST', `/api/reservations/${id}/cancel`);
    expect(response.status).toBe(200);
    expect(response.body.state).toBe('Cancelled');
  });

  it('unknown reservation: 404', async () => {
    const { app } = setup();
    expect((await call(app, 'POST', '/api/reservations/nope/confirm')).status).toBe(404);
    expect((await call(app, 'POST', '/api/reservations/nope/cancel')).status).toBe(404);
  });
});

describe('R11 — PUT /api/settings/hold-time', () => {
  it('sets the hold time: 200', async () => {
    const { app, service } = setup();
    const response = await call<unknown>(app, 'PUT', '/api/settings/hold-time', {
      holdTimeMs: 10_000,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ holdTimeMs: 10_000 });
    expect(service.holdTimeMs).toBe(10_000);
  });

  it('rejects zero: 400', async () => {
    const { app } = setup();
    expect((await call(app, 'PUT', '/api/settings/hold-time', { holdTimeMs: 0 })).status).toBe(400);
  });
});

describe('R11 — GET /api/state', () => {
  it('returns now, hold time, product views and reservations with ISO dates', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    await call(app, 'POST', '/api/products/flash-ticket/reservations', { userId: 'ana' });
    const response = await call<{
      now: string;
      holdTimeMs: number;
      products: unknown[];
      reservations: { expiresAt: string }[];
    }>(app, 'GET', '/api/state');
    expect(response.status).toBe(200);
    expect(response.body.now).toBe('2026-09-22T10:00:00.000Z');
    expect(response.body.holdTimeMs).toBe(HOLD_MS);
    expect(response.body.products).toEqual([{ ...ticket, confirmed: 0, active: 1, available: 0 }]);
    expect(response.body.reservations[0]?.expiresAt).toBe(at(HOLD_MS).toISOString());
  });
});

describe('unknown routes', () => {
  it('answer 404 as JSON', async () => {
    const { app } = setup();
    const response = await call<ErrorBody>(app, 'GET', '/api/nothing');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/http/app.test.ts`
Expected: FAIL — `Cannot find module '../../src/http/app'`

- [ ] **Step 3: Implement**

```ts path=src/http/app.ts
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { InventoryService } from '../application/inventory-service';
import type { FailureCode, Result } from '../domain/failures';
import { parseAdjustStock, parseCreateProduct, parseHoldTime, parseReserve } from './guards';

/** The one place a failure code becomes an HTTP status. */
const STATUS_BY_CODE: Record<FailureCode, ContentfulStatusCode> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  OUT_OF_STOCK: 409,
  INVALID_STATE: 409,
  ALREADY_EXISTS: 409,
};

/** Routes only: no listening, no static files, so tests can call it in-process. */
export function createApp(service: InventoryService): Hono {
  const app = new Hono();

  app.post('/api/products', async (c) => {
    const parsed = parseCreateProduct(await readJson(c));
    if (!parsed.ok) {
      return respond(c, parsed);
    }
    return respond(c, await service.createProduct(parsed.value), 201);
  });

  app.patch('/api/products/:sku', async (c) => {
    const parsed = parseAdjustStock(await readJson(c));
    if (!parsed.ok) {
      return respond(c, parsed);
    }
    return respond(c, await service.adjustStock(c.req.param('sku'), parsed.value.totalStock));
  });

  app.delete('/api/products/:sku', async (c) => {
    const result = await service.deleteProduct(c.req.param('sku'));
    return result.ok ? c.body(null, 204) : respond(c, result);
  });

  app.post('/api/products/:sku/reservations', async (c) => {
    const parsed = parseReserve(await readJson(c));
    if (!parsed.ok) {
      return respond(c, parsed);
    }
    const { userId, quantity } = parsed.value;
    return respond(c, await service.reserve(c.req.param('sku'), userId, quantity), 201);
  });

  app.post('/api/reservations/:id/confirm', async (c) =>
    respond(c, await service.confirm(c.req.param('id'))),
  );

  app.post('/api/reservations/:id/cancel', async (c) =>
    respond(c, await service.cancel(c.req.param('id'))),
  );

  app.put('/api/settings/hold-time', async (c) => {
    const parsed = parseHoldTime(await readJson(c));
    if (!parsed.ok) {
      return respond(c, parsed);
    }
    const result = service.setHoldTime(parsed.value.holdTimeMs);
    return result.ok ? c.json({ holdTimeMs: result.value }) : respond(c, result);
  });

  app.get('/api/state', async (c) => c.json(await service.snapshot()));

  app.notFound((c) =>
    c.json(
      { error: { code: 'NOT_FOUND', message: `No route for ${c.req.method} ${c.req.path}` } },
      404,
    ),
  );

  return app;
}

/** Malformed JSON becomes `undefined`, which the guards reject as "not an object". */
async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch {
    return undefined;
  }
}

function respond(
  c: Context,
  result: Result<unknown>,
  okStatus: ContentfulStatusCode = 200,
): Response {
  return result.ok
    ? c.json(result.value, okStatus)
    : c.json({ error: result.failure }, STATUS_BY_CODE[result.failure.code]);
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run tests/http/app.test.ts && npm run lint && npm run typecheck`
Expected: PASS, 20 tests; lint and typecheck exit 0. (`c.json` accepts `unknown` and serialises `Date` fields as ISO strings; both were verified against Hono 4.13 before this plan was handed over.)

- [ ] **Step 5: Commit**

```bash
git add src/http/app.ts tests/http/app.test.ts
git commit -m "feat: HTTP API over the inventory service with one code-to-status table"
```

### Task 13: Server and entry point

**Files:**
- Create: `src/http/server.ts`, `src/main.ts`
- Test: `tests/http/server.test.ts`

**Interfaces:**
- Consumes: `createApp`, `InventoryService`, `InMemoryStore`, `KeyedMutex`, `SystemClock`.
- Produces: `startServer({ port, publicDir? }): Promise<RunningServer>` where `RunningServer { url: string; close(): Promise<void> }`; `DEMO_PRODUCT`.

- [ ] **Step 1: Write the failing test**

```ts path=tests/http/server.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_PRODUCT, startServer, type RunningServer } from '../../src/http/server';

let server: RunningServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('startServer', () => {
  it('listens on the given port, seeds the demo product and serves the API', async () => {
    server = await startServer({ port: 0 });
    expect(server.url).toMatch(/^http:\/\/localhost:\d+$/);
    const response = await fetch(`${server.url}/api/state`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { products: { sku: string; available: number }[] };
    expect(body.products).toEqual([{ ...DEMO_PRODUCT, confirmed: 0, active: 0, available: 1 }]);
  });

  it('serves the page at /', async () => {
    server = await startServer({ port: 0 });
    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<title>Flash Sale Simulator</title>');
  });
});
```

- [ ] **Step 2: Create a first `public/index.html` so the second test has something to serve**

```html path=public/index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Flash Sale Simulator</title>
    <style>
      :root {
        --ink: #1f2933;
        --muted: #6b7280;
        --line: #d9dee3;
        --panel: #ffffff;
        --page: #f3f4f6;
        --accent: #2563eb;
        --ok: #15803d;
        --warn: #b45309;
        --bad: #b91c1c;
        font-family:
          system-ui,
          -apple-system,
          'Segoe UI',
          sans-serif;
        color: var(--ink);
      }
      body {
        margin: 0;
        background: var(--page);
      }
      header {
        padding: 16px 24px;
        border-bottom: 1px solid var(--line);
        background: var(--panel);
        display: flex;
        align-items: baseline;
        gap: 16px;
      }
      header h1 {
        font-size: 20px;
        margin: 0;
      }
      #connection {
        color: var(--muted);
        margin: 0;
        font-size: 14px;
      }
      .panes {
        display: grid;
        grid-template-columns: minmax(320px, 2fr) 3fr;
        gap: 16px;
        padding: 16px 24px;
      }
      @media (max-width: 900px) {
        .panes {
          grid-template-columns: 1fr;
        }
      }
      .pane {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px;
      }
      .pane h2 {
        margin: 0 0 12px;
        font-size: 16px;
      }
      form {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      input,
      select,
      button {
        font: inherit;
        padding: 6px 10px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--panel);
      }
      input[type='number'] {
        width: 90px;
      }
      button {
        cursor: pointer;
      }
      button.primary {
        background: var(--accent);
        border-color: var(--accent);
        color: white;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      th,
      td {
        text-align: left;
        padding: 6px 8px;
        border-bottom: 1px solid var(--line);
      }
      th {
        color: var(--muted);
        font-weight: 600;
      }
      td.zero {
        color: var(--bad);
        font-weight: 600;
      }
      hr {
        border: 0;
        border-top: 1px solid var(--line);
        margin: 16px 0;
      }
      .message {
        min-height: 1.2em;
        color: var(--warn);
        font-size: 14px;
        margin: 0;
      }
      .toolbar {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
      }
      #customer-cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 12px;
      }
      .card {
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 12px;
        display: grid;
        gap: 8px;
        border-left-width: 4px;
      }
      .card h3 {
        margin: 0;
        font-size: 15px;
      }
      .card .actions {
        display: flex;
        gap: 6px;
      }
      .card .status {
        margin: 0;
        font-size: 14px;
        color: var(--muted);
      }
      .card[data-state='active'] {
        border-left-color: var(--accent);
      }
      .card[data-state='confirmed'] {
        border-left-color: var(--ok);
      }
      .card[data-state='cancelled'],
      .card[data-state='expired'] {
        border-left-color: var(--warn);
      }
      .card[data-state='rejected'] {
        border-left-color: var(--bad);
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Flash Sale Simulator</h1>
      <p id="connection">connecting…</p>
    </header>
    <main class="panes">
      <section class="pane" aria-labelledby="inventory-heading">
        <h2 id="inventory-heading">Inventory</h2>
        <form id="add-product-form">
          <input id="product-name" placeholder="Product name" required />
          <input
            id="product-stock"
            type="number"
            min="0"
            step="1"
            value="1"
            required
            aria-label="Quantity"
          />
          <button type="submit" class="primary">Add product</button>
        </form>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Total</th>
              <th>Confirmed</th>
              <th>Active</th>
              <th>Available</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="product-rows"></tbody>
        </table>
        <hr />
        <form id="hold-time-form">
          <label for="hold-time">Hold time (seconds)</label>
          <input id="hold-time" type="number" min="1" step="1" />
          <button type="submit">Apply</button>
        </form>
        <p id="inventory-message" class="message"></p>
      </section>
      <section class="pane" aria-labelledby="customers-heading">
        <h2 id="customers-heading">Customers</h2>
        <div class="toolbar">
          <button id="add-customer" type="button">Add customer</button>
          <button id="everyone-buys" type="button" class="primary">Everyone buys now</button>
        </div>
        <div id="customer-cards"></div>
      </section>
    </main>
    <script type="module" src="/simulator.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Run and watch them fail**

Run: `npx vitest run tests/http/server.test.ts`
Expected: FAIL — `Cannot find module '../../src/http/server'`

- [ ] **Step 4: Implement**

```ts path=src/http/server.ts
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { InventoryService } from '../application/inventory-service';
import { SystemClock } from '../infrastructure/clock';
import { KeyedMutex } from '../infrastructure/mutex';
import { InMemoryStore } from '../infrastructure/store';
import { createApp } from './app';

export interface RunningServer {
  readonly url: string;
  close(): Promise<void>;
}

/** Seeded at startup so the page has something to sell the moment it opens. */
export const DEMO_PRODUCT = {
  sku: 'flash-ticket',
  name: 'Flash Sale Ticket',
  totalStock: 1,
} as const;

export async function startServer(options: {
  readonly port: number;
  readonly publicDir?: string;
}): Promise<RunningServer> {
  const service = new InventoryService(new InMemoryStore(), new KeyedMutex(), new SystemClock());
  const seeded = await service.createProduct(DEMO_PRODUCT);
  if (!seeded.ok) {
    throw new Error(`Could not seed the demo product: ${seeded.failure.message}`);
  }

  const app = createApp(service);
  app.use('/*', serveStatic({ root: options.publicDir ?? './public' }));

  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: options.port }, (info) => {
      resolve({
        url: `http://localhost:${String(info.port)}`,
        close: () =>
          new Promise<void>((done, failClose) => {
            server.close((error) => {
              if (error) {
                failClose(error);
              } else {
                done();
              }
            });
          }),
      });
    });
    server.once('error', reject);
  });
}
```

```ts path=src/main.ts
import { startServer } from './http/server';

const port = Number(process.env.PORT ?? '3000');
const server = await startServer({ port });
console.log(`Inventory reservation service: ${server.url}`);
```

- [ ] **Step 5: Run and watch them pass, then the whole suite**

Run: `npx vitest run tests/http/server.test.ts && npm test && npm run lint && npm run typecheck`
Expected: PASS, 2 tests; suite 115 tests in 12 files; lint and typecheck exit 0. (`serveStatic` serves `index.html` for `/` by default, and registering it after the API routes leaves the JSON 404 in place; both verified before hand-over.)

- [ ] **Step 6: Smoke the real entry point**

```bash
PORT=3999 npx tsx src/main.ts & sleep 2
curl -s localhost:3999/api/state | head -c 300; echo
curl -s -X POST localhost:3999/api/products/flash-ticket/reservations -H 'content-type: application/json' -d '{"userId":"ana"}'; echo
curl -s -X POST localhost:3999/api/products/flash-ticket/reservations -H 'content-type: application/json' -d '{"userId":"ben"}'; echo
kill %1
```
Expected: state JSON with `flash-ticket`; a 201 reservation for ana; `{"error":{"code":"OUT_OF_STOCK",...}}` for ben.

- [ ] **Step 7: Commit**

```bash
git add src/http/server.ts src/main.ts tests/http/server.test.ts public/index.html
git commit -m "feat: HTTP server with seeded demo product and static page"
```

---

## Phase 4 — Simulator page

### Task 14: The two-pane page

**Files:**
- Replace: `public/index.html`, `src/web/simulator.ts`
- Modify: `tests/http/server.test.ts` (already asserts the title; no change needed unless the title changes)

**Interfaces:**
- Consumes: the eight routes from Task 12 and the seeded product from Task 13.
- Produces: a page at `/` with the Inventory pane (add product, ± stock, remove, hold time) and the Customers pane (cards with Buy / Confirm / Cancel, "Add customer", "Everyone buys now"). No automated browser tests; the manual checklist in Step 5 is run once and recorded in the journal.

- [ ] **Step 1: Write the page**

```html path=public/index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Flash Sale Simulator</title>
    <style>
      :root {
        --ink: #1f2933;
        --muted: #6b7280;
        --line: #d9dee3;
        --panel: #ffffff;
        --page: #f3f4f6;
        --accent: #2563eb;
        --ok: #15803d;
        --warn: #b45309;
        --bad: #b91c1c;
        font-family:
          system-ui,
          -apple-system,
          'Segoe UI',
          sans-serif;
        color: var(--ink);
      }
      body {
        margin: 0;
        background: var(--page);
      }
      header {
        padding: 16px 24px;
        border-bottom: 1px solid var(--line);
        background: var(--panel);
        display: flex;
        align-items: baseline;
        gap: 16px;
      }
      header h1 {
        font-size: 20px;
        margin: 0;
      }
      #connection {
        color: var(--muted);
        margin: 0;
        font-size: 14px;
      }
      .panes {
        display: grid;
        grid-template-columns: minmax(320px, 2fr) 3fr;
        gap: 16px;
        padding: 16px 24px;
      }
      @media (max-width: 900px) {
        .panes {
          grid-template-columns: 1fr;
        }
      }
      .pane {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px;
      }
      .pane h2 {
        margin: 0 0 12px;
        font-size: 16px;
      }
      form {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      input,
      select,
      button {
        font: inherit;
        padding: 6px 10px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--panel);
      }
      input[type='number'] {
        width: 90px;
      }
      button {
        cursor: pointer;
      }
      button.primary {
        background: var(--accent);
        border-color: var(--accent);
        color: white;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      th,
      td {
        text-align: left;
        padding: 6px 8px;
        border-bottom: 1px solid var(--line);
      }
      th {
        color: var(--muted);
        font-weight: 600;
      }
      td.zero {
        color: var(--bad);
        font-weight: 600;
      }
      hr {
        border: 0;
        border-top: 1px solid var(--line);
        margin: 16px 0;
      }
      .message {
        min-height: 1.2em;
        color: var(--warn);
        font-size: 14px;
        margin: 0;
      }
      .toolbar {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
      }
      #customer-cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 12px;
      }
      .card {
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 12px;
        display: grid;
        gap: 8px;
        border-left-width: 4px;
      }
      .card h3 {
        margin: 0;
        font-size: 15px;
      }
      .card .actions {
        display: flex;
        gap: 6px;
      }
      .card .status {
        margin: 0;
        font-size: 14px;
        color: var(--muted);
      }
      .card[data-state='active'] {
        border-left-color: var(--accent);
      }
      .card[data-state='confirmed'] {
        border-left-color: var(--ok);
      }
      .card[data-state='cancelled'],
      .card[data-state='expired'] {
        border-left-color: var(--warn);
      }
      .card[data-state='rejected'] {
        border-left-color: var(--bad);
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Flash Sale Simulator</h1>
      <p id="connection">connecting…</p>
    </header>
    <main class="panes">
      <section class="pane" aria-labelledby="inventory-heading">
        <h2 id="inventory-heading">Inventory</h2>
        <form id="add-product-form">
          <input id="product-name" placeholder="Product name" required />
          <input
            id="product-stock"
            type="number"
            min="0"
            step="1"
            value="1"
            required
            aria-label="Quantity"
          />
          <button type="submit" class="primary">Add product</button>
        </form>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Total</th>
              <th>Confirmed</th>
              <th>Active</th>
              <th>Available</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="product-rows"></tbody>
        </table>
        <hr />
        <form id="hold-time-form">
          <label for="hold-time">Hold time (seconds)</label>
          <input id="hold-time" type="number" min="1" step="1" />
          <button type="submit">Apply</button>
        </form>
        <p id="inventory-message" class="message"></p>
      </section>
      <section class="pane" aria-labelledby="customers-heading">
        <h2 id="customers-heading">Customers</h2>
        <div class="toolbar">
          <button id="add-customer" type="button">Add customer</button>
          <button id="everyone-buys" type="button" class="primary">Everyone buys now</button>
        </div>
        <div id="customer-cards"></div>
      </section>
    </main>
    <script type="module" src="/simulator.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the browser module**

```ts path=src/web/simulator.ts
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
```

- [ ] **Step 3: Build, lint and typecheck**

Run: `npm run build:web && npm run lint && npm run typecheck && npm run format:check`
Expected: `public/simulator.js` exists; all exit 0. Fix any lint finding in the source (never by disabling a rule).

- [ ] **Step 4: Run the suite (the server test asserts the title)**

Run: `npm test`
Expected: 115 tests passing in 12 files

- [ ] **Step 5: Manual checklist against the real server**

```bash
npm start   # in a terminal; open http://localhost:3000
```

Run through and tick each item; record the run in the journal:
1. Page loads; header says `connected · 1 products · 0 reservations`; three customer cards say `idle`; the product picker shows `Flash Sale Ticket`.
2. Click **Everyone buys now** → exactly one card shows `reserved Flash Sale Ticket · expires in 1:5x`, the other two show `Only 0 of flash-ticket available; 1 requested.` with a red edge; Available reads `0` in red.
3. Click **Confirm** on the winner → `confirmed · Flash Sale Ticket`, green edge; Confirmed reads `1`.
4. Add product `Mug` with quantity `2`; every card's picker now lists Mug; click `+` → Total 3; `−` → 2.
5. Set hold time to `10`, Apply → message confirms; pick Mug on a losing card, **Buy** → countdown from `0:10` to `expired`, Available for Mug goes back to 2 within a second of expiry.
6. Buy Mug again, **Cancel** → `cancelled · Mug`, Available back to 2.
7. **Add customer** twice, **Everyone buys now** → two more Mug reservations succeed and the rest are rejected.
8. **Remove** Mug → its reservations vanish from the cards on the next poll.
9. Open a second tab → same state in both.

- [ ] **Step 6: Commit**

```bash
git add public/index.html src/web/simulator.ts
git commit -m "feat: flash-sale simulator page with inventory and customer panes"
```

---

## Phase 5 — Write-up

### Task 15: README

**Files:**
- Create: `README.md`

Every figure in the README comes from a command run right before writing it: `npm test` (test count and file count), `npm run test:coverage` (line, function and branch percentages), and the concurrency test's timing from Vitest's output. Replace each `<…>` below with the real value; a README with a `<…>` left in it must not be committed.

- [ ] **Step 1: Gather figures**

```bash
npm test 2>&1 | tail -6
npm run test:coverage 2>&1 | grep -E "All files|^ src"
```

- [ ] **Step 2: Write the README**

```markdown path=README.md
# Inventory Reservation System

A reservation service for flash sales that does not oversell, with an HTTP API and a simulator page.
Submitted for the Everest Engineering coding challenge (Challenge B).

- **Stack:** TypeScript (strict), Node ≥ 22.13, Hono, Vitest. Two runtime dependencies (`hono`, `@hono/node-server`).
- **Tests:** <N> tests in <F> files, including three concurrency tests; coverage <L>% lines, <Fn>% functions, <B>% branches on `src/` (page excluded).
- **Locking:** one promise-chain mutex per product around every write. See [Locking strategy](#locking-strategy).

## Quick start

```bash
npm ci
npm test
npm start          # builds the page and serves http://localhost:3000
```

`npm start` seeds one product, **Flash Sale Ticket** with stock 1. Open the page, click **Everyone
buys now**, and watch one customer win and the rest get `Only 0 of flash-ticket available`.

## What it does

- Products with stock; reservations of one or more units.
- Reservation lifecycle `Active → Confirmed | Cancelled | Expired`, hold time 2 minutes by default.
- `available = total − confirmed − active`; a reserve that would exceed it fails.
- Confirmed purchases cannot be reversed; cancel and expiry release stock at once.
- Under 500 simultaneous requests for one item, exactly one succeeds.

## API

JSON under `/api`. Failures: `{ "error": { "code", "message" } }` with `VALIDATION` 400,
`NOT_FOUND` 404, `OUT_OF_STOCK` / `INVALID_STATE` / `ALREADY_EXISTS` 409.

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/api/products` | `{ sku, name, totalStock }` | 201 product view |
| PATCH | `/api/products/:sku` | `{ totalStock }` | 200 product view |
| DELETE | `/api/products/:sku` | | 204 |
| POST | `/api/products/:sku/reservations` | `{ userId, quantity? }` | 201 reservation |
| POST | `/api/reservations/:id/confirm` | | 200 reservation |
| POST | `/api/reservations/:id/cancel` | | 200 reservation |
| PUT | `/api/settings/hold-time` | `{ holdTimeMs }` | 200 `{ holdTimeMs }` |
| GET | `/api/state` | | 200 everything, for the page |

A product view carries `confirmed`, `active` and `available` alongside `totalStock`.

## Design

```
src/domain          pure: Product + stock arithmetic, Reservation + its state machine, Result
src/application     InventoryService (the only place a lock is taken) and the ports it needs
src/infrastructure  InMemoryStore, the Mutex, SystemClock
src/http            guards (unknown → typed), routes, server
src/web             the simulator page's browser code
```

Imports point downward only. Domain functions take `now` as an argument and return `Result`
values (`{ ok: true, value }` or `{ ok: false, failure: { code, message } }`) instead of throwing;
exceptions are reserved for bugs.

Every write in the service is the same shape:

```ts
return this.#locks.withLock(sku, async () => {
  const loaded = await this.#load(sku, now); // read
  // ... pure domain decision ...
  await this.#store.saveReservation(reservation); // write
  return ok(reservation);
});
```

## Locking strategy

**The problem.** Reserving is read-then-write: load the stock, decide, save. Node runs JavaScript on
one thread, so a *synchronous* read-then-write cannot be interrupted. But storage is asynchronous
(`await store.get(...)`), and every `await` lets other requests run. Without a lock, 500 concurrent
requests all read "1 available" before any of them writes, and all 500 succeed. The test
`WITHOUT the lock the same load oversells` shows exactly that.

**The lock.** `Mutex` is a promise chain of about ten lines: each task starts only when the previous
one has settled, so tasks run one at a time in arrival order. Nothing blocks a thread; waiting is a
promise that has not resolved yet. `KeyedMutex` keeps one `Mutex` per SKU, so buyers of one product
never wait behind buyers of another.

**What is inside the lock.** Load → decide → save, and nothing else. Confirm and cancel look their
reservation up first to learn which SKU's lock to take, then reload inside the lock, because the
reservation may have changed while they waited.

**Properties.**
- Fair: first come, first served, by construction.
- Deadlock-free: an operation holds one lock and never takes a second.
- Failure-safe: a task that throws does not block the queue; the caller still gets the error.
- Reads do not lock: `snapshot()` is one store call.

**Where it stops.** The mutex lives in one process. Two instances behind a load balancer have two
separate queues and can oversell between them. Beyond one process the decision has to move into the
shared store: a conditional `UPDATE … WHERE available >= quantity`, `SELECT … FOR UPDATE`, an atomic
Redis operation, or one writer per SKU through a partitioned queue. See
[Improvements](#improvements-with-more-time).

## Expiry

No timers. A reservation carries `expiresAt`; `available()` counts it only while `expiresAt > now`,
so stock returns the instant the hold ends. Whenever a product's reservations are loaded inside a
lock, overdue ones are recorded as `Expired`; `GET /api/state` shows the effective state before
that happens. A reservation is expired at `expiresAt` exactly.

## Assumptions

1. Several products, each with its own stock and lock.
2. A reservation is for `quantity ≥ 1` units (default 1).
3. Expired at `expiresAt` exactly.
4. No authentication: confirm and cancel take a reservation id and do not check the caller.
5. Hold time is one setting per running service; existing reservations keep their `expiresAt`.
6. Lowering total stock below `confirmed + active` is rejected, not clamped.
7. Deleting a product deletes its reservations (for the simulator).
8. Dates on the wire are ISO strings.

## Testing

Written test-first. Each `describe` that covers a requirement is named by its ID from the design
spec (`R1` … `R11`), so the brief's rules can be traced to the tests that hold them.

- **Domain:** the availability arithmetic and every state transition, including the exact expiry
  boundary (t+119 999 ms holds, t+120 000 ms expires), with a fake clock.
- **Service:** the lifecycle, validation, and lazy expiry persistence.
- **Concurrency:** 500 simultaneous reserves sell exactly one; the same load without the lock
  oversells; a mixed load of reserve/confirm/cancel on two products never breaks
  `confirmed + active ≤ total`.
- **HTTP:** every route through Hono's in-process `app.request()`, the 500-request sale over
  HTTP, and one smoke test that starts the real server.
- **Page:** type-checked, exercised by hand (checklist in the design record); not browser-tested.

```bash
npm test               # <N> tests
npm run test:coverage
npm run lint && npm run typecheck && npm run format:check
```

Commits pass a `pre-commit` hook running all of the above, and a `commit-msg` hook enforcing
conventional subjects.

## Improvements with more time

1. **Persistence.** `InMemoryStore` is a `Map`; swap in a database behind the same interface.
2. **More than one instance.** Move the decision into the store (conditional update, row lock,
   atomic Redis op, or one writer per SKU). A distributed lock is the literal translation but needs
   fencing tokens; an atomic store write is safer.
3. **Idempotency keys** so a retried `reserve` does not hold twice.
4. **An expiry sweeper** to keep stored state current for reporting.
5. **Backpressure:** fail fast once sold out instead of joining the queue; cap queue length.
6. **Ownership** on confirm and cancel.
7. **Observability:** request ids, structured logs, metrics for rejections and lock wait time.
8. **Operations:** health endpoint, graceful shutdown, rate limiting.

## AI disclosure

- **Tool:** Claude Code (Anthropic), model Claude Fable 5.1.
- **How:** I chose the challenge, language, and design through a recorded conversation; the AI
  proposed the architecture, the per-SKU promise mutex, and expiry-on-read, and I approved each
  section. All code, tests and the first draft of this README were generated by the AI under my
  direction, test-first, in the commits you see.
- **What I checked:** the locking claims were demonstrated to me with runnable scripts before any
  code (with and without the lock; one process and four). I reviewed and approved the assumptions
  above and can walk through any file.
- **Where the AI was corrected:** it first recommended Go, which I rejected because I would be
  defending an unfamiliar language; it named Redis and Postgres in a design that I cut back to the
  simplest thing that works.
- The full decision log is in `docs/working/JOURNAL.md`.
```

- [ ] **Step 3: Check every figure and link**

Run: `grep -n '<' README.md | grep -v '^.*<!--' | grep -E '<[A-Za-z]' ; echo "placeholders above must be empty"`
Then `npx prettier --check README.md` is skipped (`*.md` is ignored) — read it once top to bottom.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README with locking strategy, assumptions, testing and AI disclosure"
```

### Task 16: ADRs, defence notes, rubric review, fresh-clone check

**Files:**
- Create: `docs/adr/0001-async-store-as-the-seam.md`, `docs/adr/0002-one-promise-mutex-per-sku.md`, `docs/adr/0003-expiry-computed-on-read.md`, `docs/DEFENCE-B.md`, `docs/working/RUBRIC-REVIEW.md`, `docs/working/WALKTHROUGH.md`, `docs/working/SUBMISSION-CHECKLIST.md`

- [ ] **Step 1: Write the three ADRs**

```markdown path=docs/adr/0001-async-store-as-the-seam.md
# ADR 0001 — The store is asynchronous even though it is a Map

**Status:** accepted, 2026-09-22

## Context

The brief keeps inventory in memory. In Node, a synchronous `Map` read-then-write cannot be
interrupted, so a mutex around it would be decorative and the 500-request test would pass without
any lock. The brief nonetheless grades concurrency handling and a locking-strategy explanation.

## Decision

`InventoryStore` returns promises. `InMemoryStore` implements it with two Maps and
`Promise.resolve`. Nothing else in the codebase knows the store is in memory.

## Consequences

- `await` between read and write is a real interleaving point: verified with a throwaway script
  (500 of 1 sold with no lock) and kept as the test `WITHOUT the lock the same load oversells`.
- The interface is where a database goes; the service does not change.
- Cost: the word `await` in front of store calls.
```

```markdown path=docs/adr/0002-one-promise-mutex-per-sku.md
# ADR 0002 — One promise-chain mutex per SKU

**Status:** accepted, 2026-09-22

## Context

Every write is load → decide → save across an `await`. Two callers for the same product must not
interleave; callers for different products should not wait for each other. Node has no built-in
mutex for ordinary code.

## Decision

`Mutex.runExclusive` chains each task after the previous one's settled promise. `KeyedMutex` holds
one `Mutex` per SKU. `InventoryService` wraps every write in `withLock(sku, …)`; reads take no lock.

Rejected: a single global mutex (needless serialisation across products); the `async-mutex`
package (ten lines are easier to explain than a dependency); the Web Locks API (present in Node 24
but not something I would build a submission on without checking its status); worker threads with
`Atomics` (true parallelism, but the state would be raw integers in shared memory).

## Consequences

- Fair and deadlock-free by construction; a throwing task does not block the queue.
- Throughput per product is bounded by the locked section's length; keep it to load → decide → save.
- Scope is one process. Beyond that the decision moves into the shared store (see README).
```

```markdown path=docs/adr/0003-expiry-computed-on-read.md
# ADR 0003 — Expiry is computed from `expiresAt`, not scheduled

**Status:** accepted, 2026-09-22

## Context

Reservations expire after the hold time. The obvious implementation is `setTimeout` per
reservation, which does not survive a restart, cannot be tested without waiting or faking timers,
and grows with the number of reservations.

## Decision

A reservation stores `expiresAt`. `available()` counts it only while `expiresAt > now`. Inside a
lock, `expireIfDue` records overdue reservations as `Expired` when the product is next loaded;
`snapshot()` reports the effective state without writing. A reservation is expired at `expiresAt`
exactly.

## Consequences

- Stock returns at the exact moment, with no timer and no background work.
- Tests use a fake clock and check the boundary to the millisecond.
- Stored state can lag reality until the next write to that product; a sweeper is listed as an
  improvement, not built.
```

- [ ] **Step 2: Write the walkthrough and defence notes**

`docs/working/WALKTHROUGH.md` is the study guide: reading order (`failures → reservation → product →
ports → mutex → store → inventory-service → guards → app → server → simulator`), a worked trace of
`reserve` under contention for three callers (who holds the lock when, what each one reads), the
proof that `expireIfDue` returning the same object is what makes lazy persistence cheap, the manual
page checklist result, and the list of likely interview questions. `docs/DEFENCE-B.md` answers, from
the code, at least these questions, each in three to six sentences:

1. Walk me through what happens when 500 users click Buy on the last item.
2. Why does an in-memory Map need a lock in single-threaded Node?
3. Show me the test that proves the lock is doing something.
4. What does your mutex guarantee, and what does it not?
5. Why one lock per SKU rather than one global lock?
6. Can this deadlock? Why not?
7. What happens if the task inside the lock throws?
8. Why is expiry not a timer? What is the trade-off?
9. A reservation expires at 120 000 ms exactly — why that side of the boundary?
10. What happens when two instances of this service run behind a load balancer?
11. How would you make it correct across instances? Compare two options.
12. Why is confirm reloading the reservation inside the lock?
13. Why `Result` values instead of exceptions?
14. Where does `unknown` become typed, and why there?
15. Why Hono, and why is the app separated from the server?
16. What would you add for production, in priority order?
17. What did the AI get wrong, and how did you catch it?
18. Which decisions were yours?
19. If stock were 1000 and requests 100 000, what breaks first?
20. How would you add idempotency to `reserve`?

Write `docs/working/SUBMISSION-CHECKLIST.md` in the shape of Challenge A's: study steps, make the
README true, commit history, decide what ships, submit.

- [ ] **Step 3: Rubric review**

Run the `/rubric-reviewer` protocol from `~/.claude/skills/core/rubric-reviewer/SKILL.md` against
EE's eight criteria in `docs/MISSION.md` (problem-solving approach; code structure; correctness and
completeness; edge cases; test coverage and quality; error handling; git history; production
readiness). Write `docs/working/RUBRIC-REVIEW.md` with findings, severities and dispositions. Fix
accepted findings one commit each (`fix:`/`refactor:`/`test:`), re-running the command that
exposed each.

- [ ] **Step 4: Fresh-clone check**

```bash
cd "$(mktemp -d)" && git clone /Users/kennethpalermo/Documents/projects/ee-inventory fresh && cd fresh
npm ci && npm run format:check && npm run lint && npm run typecheck && npm test
npm run build:web && (PORT=3998 npx tsx src/main.ts & sleep 2; curl -sf localhost:3998/api/state >/dev/null && echo "API OK"; curl -sf localhost:3998/ | grep -q 'Flash Sale Simulator' && echo "PAGE OK"; kill %1)
```
Expected: every command exits 0; `API OK` and `PAGE OK` printed. Record the commit hash checked.

- [ ] **Step 5: Commit the write-up**

```bash
git add docs/adr
git commit -m "docs: architecture decision records"
git add docs/DEFENCE-B.md docs/working
git commit -m "docs(internal): defence notes, walkthrough, rubric review, submission checklist"
```

---

## Self-review (done while writing)

- **Spec coverage:** R1 → Task 4; R2, R3 → Task 9; R4–R7 → Tasks 3 and 9; R8 → Tasks 8 and 9; R9 → Tasks 10 and 12; R10 → Tasks 8, 9, 11; R11 → Tasks 12 and 13. §5 modules → Tasks 2–8, 11–14. §6 locking → Tasks 6, 8, 10. §7 API and page → Tasks 12–14. §8 testing → each task's tests. §9 tooling, hooks, typing → Task 1. §10 git → every commit step. §11 phases → the five phase headings. §12 improvements → Task 15 README.
- **Placeholders:** the README's `<…>` figures are inputs from named commands, checked by a grep before commit. The walkthrough and defence notes are specified by their outline and question list because they describe code as built.
- **Type consistency:** `Result`/`Ok`/`Fail` (Task 2) used everywhere; `stockCounts`/`available` (Task 4) in the service; `expireIfDue`/`confirmReservation`/`cancelReservation` (Task 3) in the service; `withLock` (Task 5/6) in the service; `startServer`/`RunningServer`/`DEMO_PRODUCT` (Task 13) in the server test; `makeService`/`unwrap`/`unwrapFailure` (Task 8) in Tasks 9–12.

---

## Phase 6 — Additions requested after hand-over (2026-09-22)

Approved in conversation (journal, Phase 6); built test-first on top of the finished plan.

### Task 17: Audit trail and reset (R12, R13) — `503b8ef`
- `src/domain/activity.ts`: `ActivityType`, `ActivityEvent { seq, at, type, actor, message }`, `NewActivityEvent`, `INVENTORY_ACTOR`.
- `InventoryStore` gains `appendEvent`, `clearEvents`; `snapshot()` returns `events`. `InMemoryStore` assigns `seq`, keeps the latest 200.
- `InventoryService.#record(type, actor, message)` called inside the lock after each save (create, adjust, delete, hold time, reserved, rejected, confirmed, cancelled, expired-when-noticed); `reset(seed)` deletes every product under its lock, restores the hold time, restarts the log, re-creates the seed; `setHoldTime` is now async. `Snapshot.events`.
- `POST /api/reset` → 200 `Snapshot`; `createApp(service, { seed })`; `server.ts` passes `[DEMO_PRODUCT]`.
- Tests: `tests/application/inventory-service.activity.test.ts` (R13 ×4, R12 ×3), store events, route tests for `/api/reset` and `events` in `/api/state`.

### Task 18: Page — cart, remove customer, reset, activity — `32111b0`
- Cards: header with ×, product + quantity + *Add to cart*, cart lines (Active reservations) with countdown and *Remove*, *Checkout*, `Bought:` line, status. Customer names from a counter.
- Inventory pane: *Reset inventory*, **Activity** list (newest first, 50 rows, coloured by type).
- `reconcile()` keeps keyed elements instead of rebuilding rows (activity keyed by `seq@at` because reset restarts `seq`).
- Verified in Chrome against `npm start`: sale, two-line cart + checkout, remove line, remove customer with a hold, reset, activity order; no console errors.

---

## Phase 7 — Coming-soon products and the waiting list (2026-09-23, spec §14)

Executed inline, test-first, one commit per layer.

- **Task 19 — domain:** `src/domain/waitlist.ts` (entry, states, `offer`, `settle`, `leave`), `product.ts` (`releaseAt`, `isReleased`, `stockCounts` gains `waitlist` → `released`, `waiting`), failure codes `NOT_RELEASED | WAITLIST_ACTIVE | ALREADY_QUEUED`. Tests: transitions, release boundary, waiting count.
- **Task 20 — store + service:** store `saveWaitlistEntry`, `getWaitlistEntry`, `listWaitlist`, snapshot `waitlist`, delete removes entries. Service: `createProduct` with `releaseAt`, `setReleaseAt`, `joinWaitlist`, `leaveWaitlist`, `processWaitlists`, `#promote` called after every write; `reserve` gated by R14/R17; snapshot positions. Tests: R14–R18 service tests, 500 concurrent joins.
- **Task 21 — HTTP + sweeper:** guards for `releaseAt`, `parseUpdateProduct`, `parseJoinWaitlist`; routes join/leave/PATCH; `startServer` sweeper every second, cleared on close. Tests: routes; a real-time smoke (release in 1 s → offered).
- **Task 22 — page:** on-sale-at input, countdown to release, waiting column, Waiting lists section, Join waiting list / Leave on cards, missed-turn message. Verified in Chrome.
- **Task 23 — docs:** README, walkthrough, DEFENCE-B (queue questions), checklist, journal; fresh-clone check.
