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
