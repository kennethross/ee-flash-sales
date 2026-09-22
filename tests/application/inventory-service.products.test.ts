import { describe, expect, it } from 'vitest';
import { DEFAULT_HOLD_TIME_MS } from '../../src/application/inventory-service';
import { T0 } from '../support/builders';
import { makeService, unwrap, unwrapFailure } from '../support/service';

const ticket = { sku: 'flash-ticket', name: 'Flash Sale Ticket', totalStock: 1 };

describe('createProduct', () => {
  it('stores the product and reports it with zero counts', async () => {
    const { service } = makeService();
    const view = unwrap(await service.createProduct(ticket));
    expect(view).toEqual({ ...ticket, confirmed: 0, active: 0, available: 1 });
  });

  it('R10 — rejects a duplicate sku with ALREADY_EXISTS', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    expect(unwrapFailure(await service.createProduct(ticket)).code).toBe('ALREADY_EXISTS');
  });

  it.each([
    ['empty sku', { ...ticket, sku: ' ' }],
    ['empty name', { ...ticket, name: '' }],
    ['negative stock', { ...ticket, totalStock: -1 }],
    ['fractional stock', { ...ticket, totalStock: 1.5 }],
  ])('R10 — rejects %s with VALIDATION', async (_label, input) => {
    const { service } = makeService();
    expect(unwrapFailure(await service.createProduct(input)).code).toBe('VALIDATION');
  });
});

describe('adjustStock', () => {
  it('sets the total and recomputes the view', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    unwrap(await service.reserve('flash-ticket', 'ana'));
    const view = unwrap(await service.adjustStock('flash-ticket', 3));
    expect(view).toEqual({ ...ticket, totalStock: 3, confirmed: 0, active: 1, available: 2 });
  });

  it('R10 — rejects an unknown product with NOT_FOUND', async () => {
    const { service } = makeService();
    expect(unwrapFailure(await service.adjustStock('nope', 3)).code).toBe('NOT_FOUND');
  });

  it('R10 — rejects a total below confirmed + active with VALIDATION', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct({ ...ticket, totalStock: 3 }));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    unwrap(await service.confirm(held.id));
    unwrap(await service.reserve('flash-ticket', 'ben'));
    const failure = unwrapFailure(await service.adjustStock('flash-ticket', 1));
    expect(failure.code).toBe('VALIDATION');
    expect(failure.message).toContain('1 confirmed and 1 active');
    expect(unwrap(await service.adjustStock('flash-ticket', 2)).available).toBe(0);
  });

  it('R10 — rejects a negative or fractional total with VALIDATION', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    expect(unwrapFailure(await service.adjustStock('flash-ticket', -1)).code).toBe('VALIDATION');
    expect(unwrapFailure(await service.adjustStock('flash-ticket', 0.5)).code).toBe('VALIDATION');
  });
});

describe('deleteProduct', () => {
  it('removes the product and its reservations', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    unwrap(await service.deleteProduct('flash-ticket'));
    expect(unwrapFailure(await service.confirm(held.id)).code).toBe('NOT_FOUND');
    expect((await service.snapshot()).products).toEqual([]);
  });

  it('R10 — rejects an unknown product with NOT_FOUND', async () => {
    const { service } = makeService();
    expect(unwrapFailure(await service.deleteProduct('nope')).code).toBe('NOT_FOUND');
  });
});

describe('snapshot', () => {
  it('reports now, hold time, every product view and every reservation', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    unwrap(await service.createProduct({ sku: 'mug', name: 'Mug', totalStock: 2 }));
    const held = unwrap(await service.reserve('mug', 'ana'));
    const snapshot = await service.snapshot();
    expect(snapshot.now).toEqual(T0);
    expect(snapshot.holdTimeMs).toBe(DEFAULT_HOLD_TIME_MS);
    expect(snapshot.products).toEqual([
      { ...ticket, confirmed: 0, active: 0, available: 1 },
      { sku: 'mug', name: 'Mug', totalStock: 2, confirmed: 0, active: 1, available: 1 },
    ]);
    expect(snapshot.reservations).toEqual([held]);
  });
});

describe('hold time', () => {
  it('R8 — defaults to 120 000 ms and can be set per instance', () => {
    expect(makeService().service.holdTimeMs).toBe(120_000);
    expect(makeService({ holdTimeMs: 10_000 }).service.holdTimeMs).toBe(10_000);
  });

  it('R8 — setHoldTime changes it at runtime', () => {
    const { service } = makeService();
    expect(service.setHoldTime(5_000)).toEqual({ ok: true, value: 5_000 });
    expect(service.holdTimeMs).toBe(5_000);
  });

  it('R10 — setHoldTime rejects anything but a positive integer', () => {
    const { service } = makeService();
    expect(unwrapFailure(service.setHoldTime(0)).code).toBe('VALIDATION');
    expect(unwrapFailure(service.setHoldTime(-1)).code).toBe('VALIDATION');
    expect(unwrapFailure(service.setHoldTime(1.5)).code).toBe('VALIDATION');
  });
});
