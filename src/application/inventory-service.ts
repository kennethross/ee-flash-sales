import { INVENTORY_ACTOR, type ActivityEvent, type ActivityType } from '../domain/activity';
import { fail, ok, type Fail, type Result } from '../domain/failures';
import {
  available,
  isReleased,
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
import {
  holdsPlace,
  isWaiting,
  leaveWaitlist,
  offerTo,
  settle,
  type WaitlistEntry,
  type WaitlistId,
} from '../domain/waitlist';
import type { Clock, InventoryStore, LockManager } from './ports';

/** The brief's hold time: two minutes. */
export const DEFAULT_HOLD_TIME_MS = 120_000;

export interface CreateProductInput {
  readonly sku: Sku;
  readonly name: string;
  readonly totalStock: number;
  /** When sales open; absent means on sale now. */
  readonly releaseAt?: Date;
}

/** A waiting-list entry with its place in line (Waiting entries only). */
export interface WaitlistView extends WaitlistEntry {
  readonly position: number | undefined;
}

export interface Snapshot {
  readonly now: Date;
  readonly holdTimeMs: number;
  readonly products: readonly ProductView[];
  /** Reservations with their effective state: overdue Active ones are shown as Expired. */
  readonly reservations: readonly Reservation[];
  /** The audit trail, oldest first. */
  readonly events: readonly ActivityEvent[];
  /** Every waiting-list entry, in the order people joined. */
  readonly waitlist: readonly WaitlistView[];
}

interface LoadedProduct {
  readonly product: Product;
  readonly reservations: readonly Reservation[];
  readonly waitlist: readonly WaitlistEntry[];
}

/**
 * Every write is `withLock(sku, load → decide → save)`: the only place a lock is taken.
 * Deciding is done by pure domain functions; this class only sequences I/O around them, records
 * each outcome in the audit trail after it is saved, and runs the waiting list (`#promote`) after
 * every write to a product.
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
      const base = { sku: input.sku, name: input.name, totalStock: input.totalStock };
      const product: Product =
        input.releaseAt === undefined ? base : { ...base, releaseAt: input.releaseAt };
      await this.#store.saveProduct(product);
      await this.#record(
        'product-created',
        INVENTORY_ACTOR,
        `created "${product.name}" (${product.sku}) with stock ${String(product.totalStock)}${releaseNote(product)}`,
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
      await this.#store.saveProduct({ ...loaded.product, totalStock });
      await this.#record(
        'stock-adjusted',
        INVENTORY_ACTOR,
        `set stock of ${sku} to ${String(totalStock)}`,
      );
      await this.#promote(sku, now);
      return this.#view(sku, now);
    });
  }

  /** `undefined` puts the product on sale now. Holds already offered are not affected. */
  setReleaseAt(sku: Sku, releaseAt: Date | undefined): Promise<Result<ProductView>> {
    return this.#locks.withLock(sku, async () => {
      const now = this.#clock.now();
      const stored = await this.#store.getProduct(sku);
      if (stored === undefined) {
        return productNotFound(sku);
      }
      const base = { sku: stored.sku, name: stored.name, totalStock: stored.totalStock };
      const product: Product = releaseAt === undefined ? base : { ...base, releaseAt };
      await this.#store.saveProduct(product);
      await this.#record(
        'release-changed',
        INVENTORY_ACTOR,
        `${sku} on sale ${releaseAt === undefined ? 'now' : `at ${releaseAt.toISOString()}`}`,
      );
      await this.#promote(sku, now);
      return this.#view(sku, now);
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
      if (!isReleased(loaded.product, now)) {
        return fail(
          'NOT_RELEASED',
          `${sku} is not on sale until ${loaded.product.releaseAt?.toISOString() ?? ''}; join the waiting list.`,
        );
      }
      const waiting = loaded.waitlist.filter(isWaiting).length;
      if (waiting > 0) {
        return fail(
          'WAITLIST_ACTIVE',
          `${String(waiting)} ${waiting === 1 ? 'person is' : 'people are'} waiting for ${sku}; join the waiting list.`,
        );
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
      const reservation = await this.#hold(sku, userId, quantity, now);
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

  /** One place per person; if the product is on sale with free stock, the place is offered at once. */
  joinWaitlist(sku: Sku, userId: UserId): Promise<Result<WaitlistView>> {
    if (userId.trim() === '') {
      return Promise.resolve(fail('VALIDATION', 'User id must not be empty.'));
    }
    return this.#locks.withLock(sku, async () => {
      const now = this.#clock.now();
      const loaded = await this.#load(sku, now);
      if (loaded === undefined) {
        return productNotFound(sku);
      }
      if (loaded.waitlist.some((entry) => entry.userId === userId && holdsPlace(entry))) {
        return fail('ALREADY_QUEUED', `${userId} is already in the waiting list for ${sku}.`);
      }
      const entry: WaitlistEntry = {
        id: crypto.randomUUID(),
        sku,
        userId,
        joinedAt: now,
        state: 'Waiting',
        reservationId: undefined,
      };
      await this.#store.saveWaitlistEntry(entry);
      const position = loaded.waitlist.filter(isWaiting).length + 1;
      await this.#record(
        'joined-waitlist',
        userId,
        `joined the waiting list for ${sku} (#${String(position)})`,
      );
      await this.#promote(sku, now);
      return this.#waitlistView(entry.id, sku);
    });
  }

  /** A waiting person just leaves; a person holding an offer gives it up, and it passes on. */
  async leaveWaitlist(id: WaitlistId): Promise<Result<WaitlistView>> {
    const found = await this.#store.getWaitlistEntry(id);
    if (found === undefined) {
      return fail('NOT_FOUND', `Waiting-list entry ${id} does not exist.`);
    }
    return this.#locks.withLock(found.sku, async () => {
      const now = this.#clock.now();
      const current = await this.#store.getWaitlistEntry(id);
      if (current === undefined) {
        return fail('NOT_FOUND', `Waiting-list entry ${id} does not exist.`);
      }
      if (!holdsPlace(current)) {
        return fail(
          'INVALID_STATE',
          `Waiting-list entry ${id} is ${current.state}; only Waiting or Offered entries can leave.`,
        );
      }
      if (current.reservationId !== undefined) {
        const hold = await this.#store.getReservation(current.reservationId);
        const cancelled = hold === undefined ? undefined : cancelReservation(hold, now);
        if (cancelled?.ok === true) {
          await this.#store.saveReservation(cancelled.value);
          await this.#record('cancelled', current.userId, `cancelled ${units(cancelled.value)}`);
        }
      }
      await this.#store.saveWaitlistEntry(leaveWaitlist(current));
      await this.#record(
        'left-waitlist',
        current.userId,
        `left the waiting list for ${current.sku}`,
      );
      await this.#promote(current.sku, now);
      return this.#waitlistView(id, current.sku);
    });
  }

  /** The sweeper's entry point: runs the waiting list of every product, one lock at a time. */
  async processWaitlists(): Promise<void> {
    const { products } = await this.#store.snapshot();
    for (const product of products) {
      await this.#locks.withLock(product.sku, async () => {
        await this.#promote(product.sku, this.#clock.now());
      });
    }
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
    const { products, reservations, events, waitlist } = await this.#store.snapshot();
    const effective = reservations.map((reservation) => expireIfDue(reservation, now));
    return {
      now,
      holdTimeMs: this.#holdTimeMs,
      products: products.map((product) => stockCounts(product, effective, now, waitlist)),
      reservations: effective,
      events,
      waitlist: withPositions(waitlist),
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
      } else {
        const expired = expireIfDue(current, now);
        if (expired !== current) {
          await this.#recordExpiry(expired);
        }
      }
      await this.#promote(current.sku, now);
      return result;
    });
  }

  /**
   * The waiting list, run inside the product's lock. Settles offered entries by what became of
   * their hold, then, if the product is on sale, offers holds to the first in line while stock is
   * free. Idempotent: running it again offers nothing new.
   */
  async #promote(sku: Sku, now: Date): Promise<void> {
    const loaded = await this.#load(sku, now);
    if (loaded === undefined) {
      return;
    }
    const holds = new Map(loaded.reservations.map((reservation) => [reservation.id, reservation]));
    const entries: WaitlistEntry[] = [];
    for (const entry of loaded.waitlist) {
      const settled = settle(
        entry,
        entry.reservationId === undefined ? undefined : holds.get(entry.reservationId),
      );
      if (settled !== entry) {
        await this.#store.saveWaitlistEntry(settled);
        if (settled.state === 'Passed') {
          await this.#record('passed', settled.userId, `missed their turn for ${sku}`);
        }
      }
      entries.push(settled);
    }
    if (!isReleased(loaded.product, now)) {
      return;
    }
    let free = available(loaded.product, loaded.reservations, now);
    for (const entry of entries) {
      if (free < 1) {
        break;
      }
      if (!isWaiting(entry)) {
        continue;
      }
      const hold = await this.#hold(sku, entry.userId, 1, now);
      await this.#store.saveWaitlistEntry(offerTo(entry, hold));
      await this.#record(
        'offered',
        entry.userId,
        `offered 1 × ${sku} from the waiting list (hold ${seconds(this.#holdTimeMs)} s)`,
      );
      free -= 1;
    }
  }

  /** Creates and saves an Active reservation for the current hold time. Lock must be held. */
  async #hold(sku: Sku, userId: UserId, quantity: number, now: Date): Promise<Reservation> {
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
    return reservation;
  }

  /** Loads a product with its reservations and waiting list, recording any expiry now due. */
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
    return { product, reservations, waitlist: await this.#store.listWaitlist(sku) };
  }

  async #view(sku: Sku, now: Date): Promise<Result<ProductView>> {
    const loaded = await this.#load(sku, now);
    return loaded === undefined
      ? productNotFound(sku)
      : ok(stockCounts(loaded.product, loaded.reservations, now, loaded.waitlist));
  }

  async #waitlistView(id: WaitlistId, sku: Sku): Promise<Result<WaitlistView>> {
    const view = withPositions(await this.#store.listWaitlist(sku)).find(
      (entry) => entry.id === id,
    );
    return view === undefined
      ? fail('NOT_FOUND', `Waiting-list entry ${id} does not exist.`)
      : ok(view);
  }

  async #recordExpiry(expired: Reservation): Promise<void> {
    await this.#store.saveReservation(expired);
    await this.#record('expired', expired.userId, `expired ${units(expired)}`);
  }

  #record(type: ActivityType, actor: string, message: string): Promise<void> {
    return this.#store.appendEvent({ at: this.#clock.now(), type, actor, message });
  }
}

/** Numbers the Waiting entries of each product 1, 2, 3… in join order. */
function withPositions(entries: readonly WaitlistEntry[]): WaitlistView[] {
  const nextPosition = new Map<Sku, number>();
  return entries.map((entry) => {
    if (!isWaiting(entry)) {
      return { ...entry, position: undefined };
    }
    const position = nextPosition.get(entry.sku) ?? 1;
    nextPosition.set(entry.sku, position + 1);
    return { ...entry, position };
  });
}

function releaseNote(product: Product): string {
  return product.releaseAt === undefined ? '' : `, on sale at ${product.releaseAt.toISOString()}`;
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
