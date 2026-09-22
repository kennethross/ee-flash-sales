import { describe, expect, it } from 'vitest';
import type { Fail, Ok } from '../../src/domain/failures';
import type { Reservation } from '../../src/domain/reservation';
import { NoLock } from '../../src/infrastructure/mutex';
import { makeService, unwrap } from '../support/service';

const REQUESTS = 500;

const isOk = (result: Ok<Reservation> | Fail): result is Ok<Reservation> => result.ok;
const isFail = (result: Ok<Reservation> | Fail): result is Fail => !result.ok;

describe('R9 — only one user gets the last item', () => {
  it('stock 1, 500 simultaneous reserves: exactly 1 succeeds and 499 are OUT_OF_STOCK', async () => {
    const { service } = makeService();
    unwrap(
      await service.createProduct({
        sku: 'flash-ticket',
        name: 'Flash Sale Ticket',
        totalStock: 1,
      }),
    );

    const results = await Promise.all(
      Array.from({ length: REQUESTS }, (_, i) =>
        service.reserve('flash-ticket', `user-${String(i)}`),
      ),
    );

    const successes = results.filter(isOk);
    const failures = results.filter(isFail);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(REQUESTS - 1);
    expect(new Set(failures.map((failure) => failure.failure.code))).toEqual(
      new Set(['OUT_OF_STOCK']),
    );

    const snapshot = await service.snapshot();
    expect(snapshot.products[0]).toMatchObject({ active: 1, available: 0 });
    expect(snapshot.reservations).toHaveLength(1);
  });

  it('WITHOUT the lock the same load oversells: this is why the lock exists', async () => {
    const { service } = makeService({ locks: new NoLock() });
    unwrap(
      await service.createProduct({
        sku: 'flash-ticket',
        name: 'Flash Sale Ticket',
        totalStock: 1,
      }),
    );

    const results = await Promise.all(
      Array.from({ length: REQUESTS }, (_, i) =>
        service.reserve('flash-ticket', `user-${String(i)}`),
      ),
    );

    expect(results.filter(isOk).length).toBeGreaterThan(1);
    expect((await service.snapshot()).products[0]?.available).toBeLessThan(0);
  });

  it('a mixed load of reserve, confirm and cancel on two products never breaks confirmed + active ≤ total', async () => {
    const { service } = makeService();
    unwrap(await service.createProduct({ sku: 'a', name: 'A', totalStock: 10 }));
    unwrap(await service.createProduct({ sku: 'b', name: 'B', totalStock: 10 }));

    const operations = Array.from({ length: 300 }, (_, i) => {
      const sku = i % 2 === 0 ? 'a' : 'b';
      const quantity = (i % 3) + 1;
      return service.reserve(sku, `user-${String(i)}`, quantity).then(async (result) => {
        if (!result.ok) {
          return;
        }
        if (i % 3 === 0) {
          await service.confirm(result.value.id);
        } else if (i % 3 === 1) {
          await service.cancel(result.value.id);
        }
      });
    });
    await Promise.all(operations);

    const snapshot = await service.snapshot();
    for (const product of snapshot.products) {
      const confirmed = snapshot.reservations
        .filter((r) => r.sku === product.sku && r.state === 'Confirmed')
        .reduce((sum, r) => sum + r.quantity, 0);
      const active = snapshot.reservations
        .filter((r) => r.sku === product.sku && r.state === 'Active')
        .reduce((sum, r) => sum + r.quantity, 0);
      expect(product.confirmed).toBe(confirmed);
      expect(product.active).toBe(active);
      expect(product.confirmed + product.active).toBeLessThanOrEqual(product.totalStock);
      expect(product.available).toBeGreaterThanOrEqual(0);
      expect(product.confirmed + product.active).toBeGreaterThan(0);
    }
  });
});
