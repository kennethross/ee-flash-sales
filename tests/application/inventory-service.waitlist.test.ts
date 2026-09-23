import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/application/inventory-service';
import type { WaitlistState } from '../../src/domain/waitlist';
import { HOLD_MS, T0, at } from '../support/builders';
import { makeService, unwrap, unwrapFailure, type ServiceUnderTest } from '../support/service';

const RELEASE_MS = 60_000;
const drop = { sku: 'drop', name: 'Limited Drop', totalStock: 2, releaseAt: at(RELEASE_MS) };

/** A coming-soon product with ana, ben and cy in line, in that order. Clock still at T0. */
async function queued(): Promise<ServiceUnderTest> {
  const sut = makeService();
  unwrap(await sut.service.createProduct(drop));
  unwrap(await sut.service.joinWaitlist('drop', 'ana'));
  unwrap(await sut.service.joinWaitlist('drop', 'ben'));
  unwrap(await sut.service.joinWaitlist('drop', 'cy'));
  return sut;
}

function states(snapshot: Snapshot, sku = 'drop'): [string, WaitlistState, number | undefined][] {
  return snapshot.waitlist
    .filter((entry) => entry.sku === sku)
    .map((entry) => [entry.userId, entry.state, entry.position]);
}

describe('R14 — nothing sells before the release time', () => {
  it('reserve before release fails with NOT_RELEASED naming the time', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct(drop));
    clock.advance(RELEASE_MS - 1);
    const failure = unwrapFailure(await service.reserve('drop', 'ana'));
    expect(failure.code).toBe('NOT_RELEASED');
    expect(failure.message).toContain(at(RELEASE_MS).toISOString());
  });

  it('reserve at the release time succeeds when nobody is waiting', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct(drop));
    clock.advance(RELEASE_MS);
    expect((await service.reserve('drop', 'ana')).ok).toBe(true);
  });

  it('the view says whether the product is released', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct(drop));
    expect((await service.snapshot()).products[0]?.released).toBe(false);
    clock.advance(RELEASE_MS);
    expect((await service.snapshot()).products[0]?.released).toBe(true);
  });
});

describe('R15 — one place per person, first come first served', () => {
  it('joining gives positions in order', async () => {
    const { service } = await queued();
    expect(states(await service.snapshot())).toEqual([
      ['ana', 'Waiting', 1],
      ['ben', 'Waiting', 2],
      ['cy', 'Waiting', 3],
    ]);
    expect((await service.snapshot()).products[0]?.waiting).toBe(3);
  });

  it('joining twice fails with ALREADY_QUEUED', async () => {
    const { service } = await queued();
    expect(unwrapFailure(await service.joinWaitlist('drop', 'ana')).code).toBe('ALREADY_QUEUED');
  });

  it('validates the product and the user', async () => {
    const { service } = makeService();
    expect(unwrapFailure(await service.joinWaitlist('nope', 'ana')).code).toBe('NOT_FOUND');
    unwrap(await service.createProduct(drop));
    expect(unwrapFailure(await service.joinWaitlist('drop', ' ')).code).toBe('VALIDATION');
  });

  it('500 people joining at the same instant get 500 distinct positions in arrival order', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct({ ...drop, totalStock: 1 }));
    const results = await Promise.all(
      Array.from({ length: 500 }, (_, i) => service.joinWaitlist('drop', `user-${String(i)}`)),
    );
    const positions = results.map((result) => unwrap(result).position);
    expect(positions).toEqual(Array.from({ length: 500 }, (_, i) => i + 1));
  });
});

describe('R16 — at release the first in line are offered holds, then the rest as stock frees up', () => {
  it('offers holds to as many as there is stock, in order, for the current hold time', async () => {
    const { service, clock } = await queued();
    clock.advance(RELEASE_MS);
    await service.processWaitlists();

    const snapshot = await service.snapshot();
    expect(states(snapshot)).toEqual([
      ['ana', 'Offered', undefined],
      ['ben', 'Offered', undefined],
      ['cy', 'Waiting', 1],
    ]);
    expect(snapshot.products[0]).toMatchObject({ active: 2, available: 0, waiting: 1 });
    const holds = snapshot.reservations.filter((r) => r.state === 'Active');
    expect(holds.map((r) => r.userId)).toEqual(['ana', 'ben']);
    expect(holds[0]?.expiresAt).toEqual(at(RELEASE_MS + HOLD_MS));
    expect(snapshot.events.filter((e) => e.type === 'offered').map((e) => e.actor)).toEqual([
      'ana',
      'ben',
    ]);
  });

  it('nothing is offered before the release time, however often the sweeper runs', async () => {
    const { service, clock } = await queued();
    clock.advance(RELEASE_MS - 1);
    await service.processWaitlists();
    await service.processWaitlists();
    expect((await service.snapshot()).reservations).toEqual([]);
  });

  it('running the sweeper twice offers nothing twice', async () => {
    const { service, clock } = await queued();
    clock.advance(RELEASE_MS);
    await service.processWaitlists();
    await service.processWaitlists();
    expect((await service.snapshot()).reservations).toHaveLength(2);
  });

  it('a hold that expires passes the item to the next in line', async () => {
    const { service, clock } = await queued();
    clock.advance(RELEASE_MS);
    await service.processWaitlists();
    clock.advance(HOLD_MS);
    await service.processWaitlists();

    const snapshot = await service.snapshot();
    expect(states(snapshot)).toEqual([
      ['ana', 'Passed', undefined],
      ['ben', 'Passed', undefined],
      ['cy', 'Offered', undefined],
    ]);
    expect(snapshot.events.filter((e) => e.type === 'passed').map((e) => e.actor)).toEqual([
      'ana',
      'ben',
    ]);
    expect(snapshot.reservations.filter((r) => r.state === 'Active').map((r) => r.userId)).toEqual([
      'cy',
    ]);
  });

  it('a cancelled hold passes the item on immediately, without the sweeper', async () => {
    const { service, clock } = await queued();
    clock.advance(RELEASE_MS);
    await service.processWaitlists();
    const anasHold = (await service.snapshot()).reservations.find((r) => r.userId === 'ana');
    if (anasHold === undefined) throw new Error('expected ana to hold');
    unwrap(await service.cancel(anasHold.id));
    expect(states(await service.snapshot())).toEqual([
      ['ana', 'Passed', undefined],
      ['ben', 'Offered', undefined],
      ['cy', 'Offered', undefined],
    ]);
  });

  it('a confirmed hold makes the entry Bought', async () => {
    const { service, clock } = await queued();
    clock.advance(RELEASE_MS);
    await service.processWaitlists();
    const anasHold = (await service.snapshot()).reservations.find((r) => r.userId === 'ana');
    if (anasHold === undefined) throw new Error('expected ana to hold');
    unwrap(await service.confirm(anasHold.id));
    expect(states(await service.snapshot())[0]).toEqual(['ana', 'Bought', undefined]);
    expect((await service.snapshot()).products[0]).toMatchObject({ confirmed: 1, active: 1 });
  });

  it('joining after release with free stock is offered at once', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct(drop));
    clock.advance(RELEASE_MS);
    const entry = unwrap(await service.joinWaitlist('drop', 'ana'));
    expect(entry.state).toBe('Offered');
    expect(entry.position).toBeUndefined();
    expect((await service.snapshot()).reservations[0]?.userId).toBe('ana');
  });

  it('a release time already in the past is released on the next pass', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct({ ...drop, releaseAt: at(-1) }));
    expect(unwrap(await service.joinWaitlist('drop', 'ana')).state).toBe('Offered');
  });

  it('adding stock offers the next in line', async () => {
    const { service, clock } = await queued();
    clock.advance(RELEASE_MS);
    await service.processWaitlists();
    unwrap(await service.adjustStock('drop', 3));
    expect(states(await service.snapshot())[2]).toEqual(['cy', 'Offered', undefined]);
  });

  it('each offer uses the hold time in force at that moment', async () => {
    const { service, clock } = await queued();
    unwrap(await service.setHoldTime(10_000));
    clock.advance(RELEASE_MS);
    await service.processWaitlists();
    expect((await service.snapshot()).reservations[0]?.expiresAt).toEqual(at(RELEASE_MS + 10_000));
  });

  it('bringing the release forward offers at once; postponing it stops new offers only', async () => {
    const { service, clock } = await queued();
    unwrap(await service.setReleaseAt('drop', T0));
    expect(states(await service.snapshot()).map((s) => s[1])).toEqual([
      'Offered',
      'Offered',
      'Waiting',
    ]);
    unwrap(await service.setReleaseAt('drop', at(RELEASE_MS * 10)));
    clock.advance(HOLD_MS);
    await service.processWaitlists();
    expect(states(await service.snapshot()).map((s) => s[1])).toEqual([
      'Passed',
      'Passed',
      'Waiting',
    ]);
    unwrap(await service.setReleaseAt('drop', undefined));
    expect(states(await service.snapshot())[2]).toEqual(['cy', 'Offered', undefined]);
  });
});

describe('R17 — while anyone is waiting, the queue goes first', () => {
  it('a direct reserve is refused with WAITLIST_ACTIVE and how many are ahead', async () => {
    const { service, clock } = await queued();
    clock.advance(RELEASE_MS);
    await service.processWaitlists();
    const failure = unwrapFailure(await service.reserve('drop', 'dee'));
    expect(failure.code).toBe('WAITLIST_ACTIVE');
    expect(failure.message).toContain('1 ');
  });

  it('ordinary sales resume once the queue has drained', async () => {
    const { service, clock } = makeService();
    unwrap(await service.createProduct({ ...drop, totalStock: 3 }));
    unwrap(await service.joinWaitlist('drop', 'ana'));
    clock.advance(RELEASE_MS);
    await service.processWaitlists();
    expect((await service.reserve('drop', 'dee')).ok).toBe(true);
  });
});

describe('R18 — leaving the line', () => {
  it('a waiting person leaves and the positions close up', async () => {
    const { service } = await queued();
    const bens = (await service.snapshot()).waitlist.find((e) => e.userId === 'ben');
    if (bens === undefined) throw new Error('expected ben in line');
    expect(unwrap(await service.leaveWaitlist(bens.id)).state).toBe('Left');
    expect(states(await service.snapshot())).toEqual([
      ['ana', 'Waiting', 1],
      ['ben', 'Left', undefined],
      ['cy', 'Waiting', 2],
    ]);
    expect((await service.snapshot()).events.at(-1)?.type).toBe('left-waitlist');
  });

  it('leaving while holding an offer cancels the hold and passes it on', async () => {
    const { service, clock } = await queued();
    clock.advance(RELEASE_MS);
    await service.processWaitlists();
    const anas = (await service.snapshot()).waitlist.find((e) => e.userId === 'ana');
    if (anas === undefined) throw new Error('expected ana in line');
    unwrap(await service.leaveWaitlist(anas.id));
    const snapshot = await service.snapshot();
    expect(states(snapshot).map((s) => s[1])).toEqual(['Left', 'Offered', 'Offered']);
    expect(snapshot.reservations.find((r) => r.userId === 'ana')?.state).toBe('Cancelled');
  });

  it('leaving after buying, or an unknown entry, fails', async () => {
    const { service, clock } = await queued();
    clock.advance(RELEASE_MS);
    await service.processWaitlists();
    const snapshot = await service.snapshot();
    const anasHold = snapshot.reservations.find((r) => r.userId === 'ana');
    const anas = snapshot.waitlist.find((e) => e.userId === 'ana');
    if (anasHold === undefined || anas === undefined) throw new Error('expected ana to hold');
    unwrap(await service.confirm(anasHold.id));
    expect(unwrapFailure(await service.leaveWaitlist(anas.id)).code).toBe('INVALID_STATE');
    expect(unwrapFailure(await service.leaveWaitlist('nope')).code).toBe('NOT_FOUND');
  });

  it('deleting the product or resetting removes the queue', async () => {
    const { service } = await queued();
    unwrap(await service.deleteProduct('drop'));
    expect((await service.snapshot()).waitlist).toEqual([]);
    const again = await queued();
    unwrap(await again.service.reset());
    expect((await again.service.snapshot()).waitlist).toEqual([]);
  });
});
