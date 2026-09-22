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
