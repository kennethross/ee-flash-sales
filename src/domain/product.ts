import { isActive, type Reservation } from './reservation';
import { isWaiting, type WaitlistEntry } from './waitlist';

export type Sku = string;

export interface Product {
  readonly sku: Sku;
  readonly name: string;
  readonly totalStock: number;
  /** Absent for products on sale now; otherwise the instant sales open (a "coming soon" product). */
  readonly releaseAt?: Date;
}

/** A product with the numbers the business rule is made of: available = total − confirmed − active. */
export interface ProductView extends Product {
  readonly confirmed: number;
  readonly active: number;
  readonly available: number;
  readonly released: boolean;
  /** People in line, not yet offered a hold. */
  readonly waiting: number;
}

/** Released at `releaseAt` exactly (the same convention as expiry), or always when it has none. */
export function isReleased(product: Product, now: Date): boolean {
  return product.releaseAt === undefined || product.releaseAt.getTime() <= now.getTime();
}

export function stockCounts(
  product: Product,
  reservations: readonly Reservation[],
  now: Date,
  waitlist: readonly WaitlistEntry[] = [],
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
  const waiting = waitlist.filter((entry) => entry.sku === product.sku && isWaiting(entry)).length;
  return {
    ...product,
    confirmed,
    active,
    available: product.totalStock - confirmed - active,
    released: isReleased(product, now),
    waiting,
  };
}

export function available(
  product: Product,
  reservations: readonly Reservation[],
  now: Date,
): number {
  return stockCounts(product, reservations, now).available;
}
