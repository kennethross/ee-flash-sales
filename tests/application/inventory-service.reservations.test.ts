import { describe, expect, it } from 'vitest';
import { HOLD_MS, T0, at } from '../support/builders';
import { makeService, unwrap, unwrapFailure } from '../support/service';

const ticket = { sku: 'flash-ticket', name: 'Flash Sale Ticket', totalStock: 1 };
const mugs = { sku: 'mug', name: 'Mug', totalStock: 2 };

describe('R2 — reserve succeeds only when quantity ≤ available', () => {
  it('creates an Active reservation that expires one hold time from now', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    const reservation = unwrap(await service.reserve('flash-ticket', 'ana'));
    expect(reservation).toMatchObject({
      sku: 'flash-ticket',
      userId: 'ana',
      quantity: 1,
      state: 'Active',
      createdAt: T0,
      expiresAt: at(HOLD_MS),
    });
    expect(reservation.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reserves exactly the available quantity, and no more', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(mugs));
    expect((await service.reserve('mug', 'ana', 3)).ok).toBe(false);
    expect(unwrap(await service.reserve('mug', 'ana', 2)).quantity).toBe(2);
  });

  it('the brief: stock 1, User A succeeds and User B fails', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    expect((await service.reserve('flash-ticket', 'user-a')).ok).toBe(true);
    const failure = unwrapFailure(await service.reserve('flash-ticket', 'user-b'));
    expect(failure.code).toBe('OUT_OF_STOCK');
    expect(failure.message).toBe('Only 0 of flash-ticket available; 1 requested.');
  });
});

describe('R3 — a failed reserve changes nothing', () => {
  it('leaves availability and the reservation list untouched', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    unwrap(await service.reserve('flash-ticket', 'ana'));
    expect((await service.reserve('flash-ticket', 'ben')).ok).toBe(false);
    const snapshot = await service.snapshot();
    expect(snapshot.products[0]?.available).toBe(0);
    expect(snapshot.reservations).toHaveLength(1);
  });
});

describe('R4 — confirm sells the units for good', () => {
  it('keeps availability down and refuses a later cancel', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    expect(unwrap(await service.confirm(held.id)).state).toBe('Confirmed');
    expect((await service.snapshot()).products[0]).toMatchObject({ confirmed: 1, available: 0 });
    expect(unwrapFailure(await service.cancel(held.id)).code).toBe('INVALID_STATE');
  });
});

describe('R5 — cancel releases the units at once', () => {
  it('raises availability by the reserved quantity', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(mugs));
    const held = unwrap(await service.reserve('mug', 'ana', 2));
    expect((await service.snapshot()).products[0]?.available).toBe(0);
    expect(unwrap(await service.cancel(held.id)).state).toBe('Cancelled');
    expect((await service.snapshot()).products[0]?.available).toBe(2);
  });
});

describe('R6 — expiry releases the units and blocks confirm', () => {
  it('holds at t+119 999 ms and releases at t+120 000 ms', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    clock.advance(HOLD_MS - 1);
    expect((await service.snapshot()).products[0]?.available).toBe(0);
    clock.advance(1);
    expect((await service.snapshot()).products[0]?.available).toBe(1);
    const failure = unwrapFailure(await service.confirm(held.id));
    expect(failure.code).toBe('INVALID_STATE');
    expect(failure.message).toContain('Expired');
  });

  it('confirm at t+119 999 ms still succeeds', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    clock.advance(HOLD_MS - 1);
    expect(unwrap(await service.confirm(held.id)).state).toBe('Confirmed');
  });

  it('another user can reserve the item once the hold has expired', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct(ticket));
    unwrap(await service.reserve('flash-ticket', 'ana'));
    clock.advance(HOLD_MS);
    expect(unwrap(await service.reserve('flash-ticket', 'ben')).userId).toBe('ben');
  });

  it('snapshot shows an overdue reservation as Expired before any write records it', async () => {
    const { service, clock, store } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    clock.advance(HOLD_MS);
    expect((await service.snapshot()).reservations[0]?.state).toBe('Expired');
    expect((await store.getReservation(held.id))?.state).toBe('Active');
  });

  it('the next write to the product records the expiry', async () => {
    const { service, clock, store } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    clock.advance(HOLD_MS);
    unwrap(await service.reserve('flash-ticket', 'ben'));
    expect((await store.getReservation(held.id))?.state).toBe('Expired');
  });

  it('a failed confirm on an overdue reservation also records the expiry', async () => {
    const { service, clock, store } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    clock.advance(HOLD_MS);
    expect((await service.confirm(held.id)).ok).toBe(false);
    expect((await store.getReservation(held.id))?.state).toBe('Expired');
  });
});

describe('R7 — confirm and cancel need an Active reservation', () => {
  it('confirm twice fails the second time', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    unwrap(await service.confirm(held.id));
    const failure = unwrapFailure(await service.confirm(held.id));
    expect(failure.code).toBe('INVALID_STATE');
    expect(failure.message).toContain('Confirmed');
  });

  it('cancel after cancel fails', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    unwrap(await service.cancel(held.id));
    expect(unwrapFailure(await service.cancel(held.id)).message).toContain('Cancelled');
  });
});

describe('R8 — hold time applies to new reservations only', () => {
  it('a shorter hold time does not shorten an existing reservation', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct(mugs));
    const first = unwrap(await service.reserve('mug', 'ana'));
    unwrap(service.setHoldTime(10_000));
    const second = unwrap(await service.reserve('mug', 'ben'));
    expect(first.expiresAt).toEqual(at(HOLD_MS));
    expect(second.expiresAt).toEqual(at(10_000));
    clock.advance(10_000);
    expect((await service.snapshot()).products[0]).toMatchObject({ active: 1, available: 1 });
  });
});

describe('R10 — validation', () => {
  it('rejects an unknown product with NOT_FOUND', async () => {
    const { service } = makeService();
    expect(unwrapFailure(await service.reserve('nope', 'ana')).code).toBe('NOT_FOUND');
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects quantity %s with VALIDATION', async (quantity) => {
    const { service } = makeService();
    unwrap(await service.createProduct(mugs));
    expect(unwrapFailure(await service.reserve('mug', 'ana', quantity)).code).toBe('VALIDATION');
  });

  it('rejects an empty user id with VALIDATION', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(mugs));
    expect(unwrapFailure(await service.reserve('mug', '  ')).code).toBe('VALIDATION');
  });

  it('confirm and cancel of an unknown reservation fail with NOT_FOUND', async () => {
    const { service } = makeService();
    expect(unwrapFailure(await service.confirm('nope')).code).toBe('NOT_FOUND');
    expect(unwrapFailure(await service.cancel('nope')).code).toBe('NOT_FOUND');
  });
});
