import { describe, expect, it } from 'vitest';
import { available, stockCounts, type Product } from '../../src/domain/product';
import { HOLD_MS, T0, aReservation, at } from '../support/builders';

const ticket: Product = { sku: 'flash-ticket', name: 'Flash Sale Ticket', totalStock: 5 };

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
