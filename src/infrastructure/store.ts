import type { InventoryStore } from '../application/ports';
import type { ActivityEvent, NewActivityEvent } from '../domain/activity';
import type { Product, Sku } from '../domain/product';
import type { Reservation, ReservationId } from '../domain/reservation';
import type { WaitlistEntry, WaitlistId } from '../domain/waitlist';

/** Events kept in memory; older ones are dropped. Enough for the page, bounded for the process. */
const EVENT_CAP = 200;

/**
 * Three Maps and an event list. Methods return promises because the port is asynchronous (see
 * `InventoryStore`); `Promise.resolve` rather than `async` because nothing here awaits.
 */
export class InMemoryStore implements InventoryStore {
  readonly #products = new Map<Sku, Product>();
  readonly #reservations = new Map<ReservationId, Reservation>();
  /** A Map keeps insertion order even when a key is set again, which is the queue order. */
  readonly #waitlist = new Map<WaitlistId, WaitlistEntry>();
  #events: ActivityEvent[] = [];
  #nextSeq = 1;

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
    for (const [id, entry] of this.#waitlist) {
      if (entry.sku === sku) {
        this.#waitlist.delete(id);
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

  saveWaitlistEntry(entry: WaitlistEntry): Promise<void> {
    this.#waitlist.set(entry.id, entry);
    return Promise.resolve();
  }

  getWaitlistEntry(id: WaitlistId): Promise<WaitlistEntry | undefined> {
    return Promise.resolve(this.#waitlist.get(id));
  }

  listWaitlist(sku: Sku): Promise<readonly WaitlistEntry[]> {
    return Promise.resolve([...this.#waitlist.values()].filter((entry) => entry.sku === sku));
  }

  appendEvent(event: NewActivityEvent): Promise<void> {
    this.#events.push({ ...event, seq: this.#nextSeq });
    this.#nextSeq += 1;
    if (this.#events.length > EVENT_CAP) {
      this.#events.shift();
    }
    return Promise.resolve();
  }

  clearEvents(): Promise<void> {
    this.#events = [];
    this.#nextSeq = 1;
    return Promise.resolve();
  }

  snapshot(): Promise<{
    readonly products: readonly Product[];
    readonly reservations: readonly Reservation[];
    readonly events: readonly ActivityEvent[];
    readonly waitlist: readonly WaitlistEntry[];
  }> {
    return Promise.resolve({
      products: [...this.#products.values()],
      reservations: [...this.#reservations.values()],
      events: [...this.#events],
      waitlist: [...this.#waitlist.values()],
    });
  }
}
