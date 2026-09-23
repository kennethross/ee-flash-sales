import { describe, expect, it } from 'vitest';
import { available, isReleased, stockCounts, type Product } from '../../src/domain/product';
import { HOLD_MS, T0, aReservation, anEntry, at } from '../support/builders';

const ticket: Product = { sku: 'flash-ticket', name: 'Flash Sale Ticket', totalStock: 5 };
const comingSoon: Product = { ...ticket, releaseAt: at(60_000) };

describe('R14 — a product is released at releaseAt exactly, or always when it has none', () => {
  it('has no release time: released', () => {
    expect(isReleased(ticket, T0)).toBe(true);
  });

  it('one millisecond before releaseAt: not released', () => {
    expect(isReleased(comingSoon, at(59_999))).toBe(false);
  });

  it('at releaseAt: released', () => {
    expect(isReleased(comingSoon, at(60_000))).toBe(true);
  });

  it('the view carries released and the number waiting', () => {
    const waitlist = [
      anEntry({ id: 'w1', userId: 'ana' }),
      anEntry({ id: 'w2', userId: 'ben' }),
      anEntry({ id: 'w3', userId: 'cy', state: 'Offered', reservationId: 'r' }),
      anEntry({ id: 'w4', userId: 'dee', sku: 'other' }),
    ];
    expect(stockCounts(comingSoon, [], T0, waitlist)).toMatchObject({
      released: false,
      waiting: 2,
      releaseAt: at(60_000),
    });
    expect(stockCounts(ticket, [], T0)).toMatchObject({ released: true, waiting: 0 });
  });
});

describe('R1 — available = total − confirmed − active', () => {
  it('counts confirmed and active reservations against total stock', () => {
    const reservations = [
      aReservation({ id: 'c1', state: 'Confirmed' }),
      aReservation({ id: 'c2', state: 'Confirmed' }),
      aReservation({ id: 'a1', state: 'Active' }),
    ];
    expect(stockCounts(ticket, reservations, T0)).toEqual({
      ...ticket,
      confirmed: 2,
      active: 1,
      available: 2,
      released: true,
      waiting: 0,
    });
  });

  it('sums quantities', () => {
    const reservations = [aReservation({ id: 'a1', quantity: 3 })];
    expect(available(ticket, reservations, T0)).toBe(2);
  });

  it('ignores cancelled reservations', () => {
    expect(available(ticket, [aReservation({ state: 'Cancelled' })], T0)).toBe(5);
  });

  it('ignores expired reservations, recorded or not', () => {
    const reservations = [
      aReservation({ id: 'e1', state: 'Expired' }),
      aReservation({ id: 'e2', state: 'Active' }),
    ];
    expect(available(ticket, reservations, at(HOLD_MS))).toBe(5);
  });

  it('ignores reservations for other products', () => {
    expect(available(ticket, [aReservation({ sku: 'other' })], T0)).toBe(5);
  });

  it('reports zero available when everything is held', () => {
    const reservations = [aReservation({ quantity: 5 })];
    expect(stockCounts(ticket, reservations, T0).available).toBe(0);
  });
});
