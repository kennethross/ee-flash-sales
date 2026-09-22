import { describe, expect, it } from 'vitest';
import type { Product } from '../../src/domain/product';
import { InMemoryStore } from '../../src/infrastructure/store';
import { T0, aReservation } from '../support/builders';

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

  it('snapshot returns every product, reservation and event', async () => {
    const store = new InMemoryStore();
    await store.saveProduct(ticket);
    await store.saveProduct(mug);
    await store.saveReservation(aReservation({ id: 'r1' }));
    await store.appendEvent({
      at: T0,
      type: 'reserved',
      actor: 'ana',
      message: 'reserved 1 × mug',
    });
    expect(await store.snapshot()).toEqual({
      products: [ticket, mug],
      reservations: [aReservation({ id: 'r1' })],
      events: [{ seq: 1, at: T0, type: 'reserved', actor: 'ana', message: 'reserved 1 × mug' }],
    });
  });

  it('numbers events in insertion order, keeps the latest 200, and can clear them', async () => {
    const store = new InMemoryStore();
    for (let i = 0; i < 201; i += 1) {
      await store.appendEvent({ at: T0, type: 'reserved', actor: 'ana', message: String(i) });
    }
    const { events } = await store.snapshot();
    expect(events).toHaveLength(200);
    expect(events[0]).toMatchObject({ seq: 2, message: '1' });
    expect(events.at(-1)).toMatchObject({ seq: 201, message: '200' });
    await store.clearEvents();
    expect((await store.snapshot()).events).toEqual([]);
    await store.appendEvent({ at: T0, type: 'reset', actor: 'inventory', message: 'reset' });
    expect((await store.snapshot()).events[0]?.seq).toBe(1);
  });
});
