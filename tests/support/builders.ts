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
