import { describe, expect, it } from 'vitest';
import type { Product } from '../../src/domain/product';
import { InMemoryStore } from '../../src/infrastructure/store';
import { aReservation } from '../support/builders';

const ticket: Product = { sku: 'flash-ticket', name: 'Flash Sale Ticket', totalStock: 1 };
const mug: Product = { sku: 'mug', name: 'Mug', totalStock: 10 };

describe('InMemoryStore', () => {
  it('round-trips products', async () => {
    const store = new InMemoryStore();
    expect(await store.getProduct('flash-ticket')).toBeUndefined();
    await store.saveProduct(ticket);
    expect(await store.getProduct('flash-ticket')).toEqual(ticket);
    await store.saveProduct({ ...ticket, totalStock: 3 });
    expect(await store.getProduct('flash-ticket')).toEqual({ ...ticket, totalStock: 3 });
  });

  it('round-trips reservations and lists them per product in insertion order', async () => {
    const store = new InMemoryStore();
    const first = aReservation({ id: 'r1' });
    const second = aReservation({ id: 'r2' });
    const other = aReservation({ id: 'r3', sku: 'mug' });
    await store.saveReservation(second);
    await store.saveReservation(first);
    await store.saveReservation(other);
    expect(await store.getReservation('r1')).toEqual(first);
    expect(await store.getReservation('missing')).toBeUndefined();
    expect(await store.listReservations('flash-ticket')).toEqual([second, first]);
  });

  it('deleting a product removes its reservations only', async () => {
    const store = new InMemoryStore();
    await store.saveProduct(ticket);
    await store.saveProduct(mug);
    await store.saveReservation(aReservation({ id: 'r1' }));
    await store.saveReservation(aReservation({ id: 'r2', sku: 'mug' }));
    await store.deleteProduct('flash-ticket');
    expect(await store.getProduct('flash-ticket')).toBeUndefined();
    expect(await store.getReservation('r1')).toBeUndefined();
    expect(await store.getProduct('mug')).toEqual(mug);
    expect(await store.getReservation('r2')).toBeDefined();
  });

  it('snapshot returns every product and reservation', async () => {
    const store = new InMemoryStore();
    await store.saveProduct(ticket);
    await store.saveProduct(mug);
    await store.saveReservation(aReservation({ id: 'r1' }));
    expect(await store.snapshot()).toEqual({
      products: [ticket, mug],
      reservations: [aReservation({ id: 'r1' })],
    });
  });
});
