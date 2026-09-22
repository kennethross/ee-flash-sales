import { INVENTORY_ACTOR, type ActivityEvent, type ActivityType } from '../domain/activity';
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
  /** The audit trail, oldest first. */
  readonly events: readonly ActivityEvent[];
}

interface LoadedProduct {
  readonly product: Product;
  readonly reservations: readonly Reservation[];
}

/**
 * Every write is `withLock(sku, load → decide → save)`: the only place a lock is taken.
 * Deciding is done by pure domain functions; this class only sequences I/O around them, and
 * records each outcome in the audit trail after it is saved.
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
  async setHoldTime(ms: number): Promise<Result<number>> {
    if (!isPositiveInteger(ms)) {
      return fail('VALIDATION', 'Hold time must be a positive integer of milliseconds.');
    }
    this.#holdTimeMs = ms;
    await this.#record('hold-time-changed', INVENTORY_ACTOR, `hold time set to ${seconds(ms)} s`);
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
      await this.#record(
        'product-created',
        INVENTORY_ACTOR,
        `created "${product.name}" (${product.sku}) with stock ${String(product.totalStock)}`,
      );
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
      await this.#record(
        'stock-adjusted',
        INVENTORY_ACTOR,
        `set stock of ${sku} to ${String(totalStock)}`,
      );
      return ok(stockCounts(product, loaded.reservations, now));
    });
  }

  deleteProduct(sku: Sku): Promise<Result<undefined>> {
    return this.#locks.withLock(sku, async () => {
      if ((await this.#store.getProduct(sku)) === undefined) {
        return productNotFound(sku);
      }
      await this.#store.deleteProduct(sku);
      await this.#record('product-deleted', INVENTORY_ACTOR, `deleted ${sku}`);
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
        const rejection = fail(
          'OUT_OF_STOCK',
          `Only ${String(free)} of ${sku} available; ${String(quantity)} requested.`,
        );
        await this.#record('rejected', userId, `rejected: ${rejection.failure.message}`);
        return rejection;
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
      await this.#record(
        'reserved',
        userId,
        `reserved ${units(reservation)} (hold ${seconds(this.#holdTimeMs)} s)`,
      );
      return ok(reservation);
    });
  }

  confirm(id: ReservationId): Promise<Result<Reservation>> {
    return this.#transition(id, confirmReservation, 'confirmed');
  }

  cancel(id: ReservationId): Promise<Result<Reservation>> {
    return this.#transition(id, cancelReservation, 'cancelled');
  }

  /**
   * Back to a known state: every product and reservation gone, the hold time at its default, the
   * audit trail restarted, then the seed products created. Each delete takes its product's lock,
   * so a reserve racing the reset is serialised and finds no product.
   */
  async reset(seed: readonly CreateProductInput[] = []): Promise<Result<Snapshot>> {
    const { products } = await this.#store.snapshot();
    for (const product of products) {
      await this.deleteProduct(product.sku);
    }
    this.#holdTimeMs = DEFAULT_HOLD_TIME_MS;
    await this.#store.clearEvents();
    await this.#record('reset', INVENTORY_ACTOR, 'inventory reset to its seed');
    for (const input of seed) {
      const created = await this.createProduct(input);
      if (!created.ok) {
        return created;
      }
    }
    return ok(await this.snapshot());
  }

  /** A read: takes no lock. One store call, so the view is consistent. */
  async snapshot(): Promise<Snapshot> {
    const now = this.#clock.now();
    const { products, reservations, events } = await this.#store.snapshot();
    const effective = reservations.map((reservation) => expireIfDue(reservation, now));
    return {
      now,
      holdTimeMs: this.#holdTimeMs,
      products: products.map((product) => stockCounts(product, effective, now)),
      reservations: effective,
      events,
    };
  }

  /**
   * Looks the reservation up to learn which product's lock to take, then reloads it inside the
   * lock: another caller may have changed it while this one waited.
   */
  async #transition(
    id: ReservationId,
    apply: (reservation: Reservation, now: Date) => Result<Reservation>,
    outcome: 'confirmed' | 'cancelled',
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
      if (result.ok) {
        await this.#store.saveReservation(result.value);
        await this.#record(outcome, current.userId, `${outcome} ${units(current)}`);
        return result;
      }
      const expired = expireIfDue(current, now);
      if (expired !== current) {
        await this.#recordExpiry(expired);
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
        await this.#recordExpiry(current);
      }
      reservations.push(current);
    }
    return { product, reservations };
  }

  async #recordExpiry(expired: Reservation): Promise<void> {
    await this.#store.saveReservation(expired);
    await this.#record('expired', expired.userId, `expired ${units(expired)}`);
  }

  #record(type: ActivityType, actor: string, message: string): Promise<void> {
    return this.#store.appendEvent({ at: this.#clock.now(), type, actor, message });
  }
}

function productNotFound(sku: Sku): Fail {
  return fail('NOT_FOUND', `Product ${sku} does not exist.`);
}

function reservationNotFound(id: ReservationId): Fail {
  return fail('NOT_FOUND', `Reservation ${id} does not exist.`);
}

function units(reservation: Reservation): string {
  return `${String(reservation.quantity)} × ${reservation.sku}`;
}

function seconds(ms: number): string {
  return String(ms / 1000);
}

// Safe integers only: beyond 2^53 the stock arithmetic would silently lose precision.
function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
