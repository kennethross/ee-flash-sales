import type { Sku } from './product';
import type { Reservation, ReservationId, UserId } from './reservation';

export type WaitlistId = string;

/**
 * Waiting: in line. Offered: a hold was created for them; it is theirs to confirm before it
 * expires. Bought / Passed: what became of that hold. Left: they gave up their place.
 */
export type WaitlistState = 'Waiting' | 'Offered' | 'Bought' | 'Passed' | 'Left';

export interface WaitlistEntry {
  readonly id: WaitlistId;
  readonly sku: Sku;
  readonly userId: UserId;
  readonly joinedAt: Date;
  readonly state: WaitlistState;
  /** The hold this entry was offered; set once the state leaves Waiting. */
  readonly reservationId: ReservationId | undefined;
}

export function isWaiting(entry: WaitlistEntry): boolean {
  return entry.state === 'Waiting';
}

/** Whether the entry still occupies a place in the line (so the same person cannot join twice). */
export function holdsPlace(entry: WaitlistEntry): boolean {
  return entry.state === 'Waiting' || entry.state === 'Offered';
}

/** Precondition: the entry is Waiting and the reservation was just created for it. */
export function offerTo(entry: WaitlistEntry, reservation: Reservation): WaitlistEntry {
  return { ...entry, state: 'Offered', reservationId: reservation.id };
}

/**
 * Moves an Offered entry on according to what became of its hold. Returns the same object when
 * nothing has changed, so callers can detect a transition by identity.
 */
export function settle(entry: WaitlistEntry, reservation: Reservation | undefined): WaitlistEntry {
  if (entry.state !== 'Offered' || reservation === undefined) {
    return entry;
  }
  switch (reservation.state) {
    case 'Confirmed':
      return { ...entry, state: 'Bought' };
    case 'Cancelled':
    case 'Expired':
      return { ...entry, state: 'Passed' };
    case 'Active':
      return entry;
  }
}

export function leaveWaitlist(entry: WaitlistEntry): WaitlistEntry {
  return { ...entry, state: 'Left' };
}
