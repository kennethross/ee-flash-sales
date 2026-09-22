import { describe, expect, it } from 'vitest';
import {
  cancelReservation,
  confirmReservation,
  expireIfDue,
  isActive,
} from '../../src/domain/reservation';
import { HOLD_MS, T0, aReservation, at } from '../support/builders';

describe('R4 — confirm moves Active to Confirmed', () => {
  it('returns a Confirmed copy and leaves the original untouched', () => {
    const active = aReservation();
    const result = confirmReservation(active, T0);
    expect(result).toEqual({ ok: true, value: { ...active, state: 'Confirmed' } });
    expect(active.state).toBe('Active');
  });
});

describe('R5 — cancel moves Active to Cancelled', () => {
  it('returns a Cancelled copy', () => {
    const result = cancelReservation(aReservation(), T0);
    expect(result).toEqual({ ok: true, value: { ...aReservation(), state: 'Cancelled' } });
  });
});

describe('R6 — a reservation is expired at expiresAt exactly', () => {
  it('is active one millisecond before expiry', () => {
    expect(isActive(aReservation(), at(HOLD_MS - 1))).toBe(true);
  });

  it('is not active at expiry', () => {
    expect(isActive(aReservation(), at(HOLD_MS))).toBe(false);
  });

  it('expireIfDue returns the same object while the hold lasts', () => {
    const active = aReservation();
    expect(expireIfDue(active, at(HOLD_MS - 1))).toBe(active);
  });

  it('expireIfDue returns an Expired copy once due', () => {
    const active = aReservation();
    expect(expireIfDue(active, at(HOLD_MS))).toEqual({ ...active, state: 'Expired' });
  });

  it('expireIfDue leaves non-Active reservations alone even when past expiresAt', () => {
    const confirmed = aReservation({ state: 'Confirmed' });
    expect(expireIfDue(confirmed, at(HOLD_MS + 1))).toBe(confirmed);
  });

  it('confirm one millisecond before expiry succeeds', () => {
    expect(confirmReservation(aReservation(), at(HOLD_MS - 1)).ok).toBe(true);
  });

  it('confirm at expiry fails as Expired', () => {
    const result = confirmReservation(aReservation(), at(HOLD_MS));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('INVALID_STATE');
      expect(result.failure.message).toContain('Expired');
    }
  });
});

describe('R7 — confirm and cancel apply only to Active reservations', () => {
  it.each([
    ['confirm', 'Cancelled', confirmReservation],
    ['confirm', 'Confirmed', confirmReservation],
    ['confirm', 'Expired', confirmReservation],
    ['cancel', 'Confirmed', cancelReservation],
    ['cancel', 'Cancelled', cancelReservation],
    ['cancel', 'Expired', cancelReservation],
  ] as const)(
    '%s on a %s reservation fails with INVALID_STATE naming the state',
    (_verb, state, apply) => {
      const result = apply(aReservation({ state }), T0);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('INVALID_STATE');
        expect(result.failure.message).toContain(state);
      }
    },
  );

  it('confirmed purchases cannot be reversed', () => {
    const confirmed = confirmReservation(aReservation(), T0);
    if (!confirmed.ok) throw new Error('expected confirm to succeed');
    expect(cancelReservation(confirmed.value, T0).ok).toBe(false);
  });
});
