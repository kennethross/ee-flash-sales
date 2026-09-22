import type { ActivityEvent, NewActivityEvent } from '../domain/activity';
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
  /** Appends to the audit trail. The store assigns `seq` in insertion order and may cap the length. */
  appendEvent(event: NewActivityEvent): Promise<void>;
  clearEvents(): Promise<void>;
  snapshot(): Promise<{
    readonly products: readonly Product[];
    readonly reservations: readonly Reservation[];
    readonly events: readonly ActivityEvent[];
  }>;
}

/** Runs `task` while holding the lock for `key`; tasks with the same key never overlap. */
export interface LockManager {
  withLock<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}
