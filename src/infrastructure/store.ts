import type { InventoryStore } from '../application/ports';
import type { ActivityEvent, NewActivityEvent } from '../domain/activity';
import type { Product, Sku } from '../domain/product';
import type { Reservation, ReservationId } from '../domain/reservation';

/** Events kept in memory; older ones are dropped. Enough for the page, bounded for the process. */
const EVENT_CAP = 200;

/**
 * Two Maps and an event list. Methods return promises because the port is asynchronous (see
 * `InventoryStore`); `Promise.resolve` rather than `async` because nothing here awaits.
 */
export class InMemoryStore implements InventoryStore {
  readonly #products = new Map<Sku, Product>();
  readonly #reservations = new Map<ReservationId, Reservation>();
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
  }> {
    return Promise.resolve({
      products: [...this.#products.values()],
      reservations: [...this.#reservations.values()],
      events: [...this.#events],
    });
  }
}
