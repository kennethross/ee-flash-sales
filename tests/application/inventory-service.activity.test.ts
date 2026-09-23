import { describe, expect, it } from 'vitest';
import { INVENTORY_ACTOR, type ActivityEvent } from '../../src/domain/activity';
import { HOLD_MS, T0 } from '../support/builders';
import { makeService, unwrap } from '../support/service';

const ticket = { sku: 'flash-ticket', name: 'Flash Sale Ticket', totalStock: 1 };

const brief = (event: ActivityEvent): [string, string] => [event.type, event.actor];

describe('R13 — every action of a person or the inventory is recorded', () => {
  it('records the flash sale in the order it happened', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    expect((await service.reserve('flash-ticket', 'ben')).ok).toBe(false);
    unwrap(await service.confirm(held.id));

    const { events } = await service.snapshot();
    expect(events.map(brief)).toEqual([
      ['product-created', INVENTORY_ACTOR],
      ['reserved', 'ana'],
      ['rejected', 'ben'],
      ['confirmed', 'ana'],
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(events.every((event) => event.at.getTime() === T0.getTime())).toBe(true);
    expect(events[1]?.message).toBe('reserved 1 × flash-ticket (hold 120 s)');
    expect(events[2]?.message).toBe('rejected: Only 0 of flash-ticket available; 1 requested.');
    expect(events[3]?.message).toBe('confirmed 1 × flash-ticket');
  });

  it('records cancel, expiry when it is noticed, stock changes, deletion and hold time', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct({ sku: 'mug', name: 'Mug', totalStock: 3 }));
    const first = unwrap(await service.reserve('mug', 'ana', 2));
    unwrap(await service.cancel(first.id));
    unwrap(await service.reserve('mug', 'ben'));
    clock.advance(HOLD_MS);
    unwrap(await service.adjustStock('mug', 5)); // loads the product: ben's expiry is noticed here
    unwrap(await service.setHoldTime(10_000));
    unwrap(await service.deleteProduct('mug'));

    const { events } = await service.snapshot();
    expect(events.map(brief)).toEqual([
      ['product-created', INVENTORY_ACTOR],
      ['reserved', 'ana'],
      ['cancelled', 'ana'],
      ['reserved', 'ben'],
      ['expired', 'ben'],
      ['stock-adjusted', INVENTORY_ACTOR],
      ['hold-time-changed', INVENTORY_ACTOR],
      ['product-deleted', INVENTORY_ACTOR],
    ]);
    expect(events[2]?.message).toBe('cancelled 2 × mug');
    expect(events[4]?.message).toBe('expired 1 × mug');
    expect(events[4]?.at.getTime()).toBe(T0.getTime() + HOLD_MS);
    expect(events[5]?.message).toBe('set stock of mug to 5');
    expect(events[6]?.message).toBe('hold time set to 10 s');
    expect(events[7]?.message).toBe('deleted mug');
  });

  it('a failed confirm on an overdue reservation records the expiry', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct(ticket));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    clock.advance(HOLD_MS);
    expect((await service.confirm(held.id)).ok).toBe(false);
    const { events } = await service.snapshot();
    expect(events.at(-1)?.type).toBe('expired');
  });

  it('keeps only the latest 200 events, with sequence numbers that keep counting', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct({ sku: 'mug', name: 'Mug', totalStock: 1_000 }));
    for (let i = 0; i < 249; i += 1) {
      unwrap(await service.reserve('mug', `user-${String(i)}`));
    }
    const { events } = await service.snapshot();
    expect(events).toHaveLength(200);
    expect(events[0]?.seq).toBe(51);
    expect(events.at(-1)?.seq).toBe(250);
  });
});

describe('R12 — reset returns the inventory to its seed', () => {
  it('removes every product and reservation, restores the hold time, seeds, and starts a fresh log', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct(ticket));
    unwrap(await service.createProduct({ sku: 'mug', name: 'Mug', totalStock: 2 }));
    const held = unwrap(await service.reserve('flash-ticket', 'ana'));
    unwrap(await service.setHoldTime(10_000));
    clock.advance(1_000);

    const snapshot = unwrap(await service.reset([ticket]));

    expect(snapshot.holdTimeMs).toBe(120_000);
    expect(snapshot.products).toEqual([
      { ...ticket, confirmed: 0, active: 0, available: 1, released: true, waiting: 0 },
    ]);
    expect(snapshot.reservations).toEqual([]);
    expect(snapshot.events.map(brief)).toEqual([
      ['reset', INVENTORY_ACTOR],
      ['product-created', INVENTORY_ACTOR],
    ]);
    expect(snapshot.events[0]?.seq).toBe(1);
    expect((await service.confirm(held.id)).ok).toBe(false);
  });

  it('with no seed leaves an empty inventory', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct(ticket));
    const snapshot = unwrap(await service.reset());
    expect(snapshot.products).toEqual([]);
    expect(snapshot.events).toHaveLength(1);
  });

  it('rejects an invalid seed', async () => {
    const { service } = makeService();
    const result = await service.reset([{ ...ticket, totalStock: -1 }]);
    expect(result.ok).toBe(false);
  });
});
