import type { LockManager } from '../../src/application/ports';
import { InventoryService } from '../../src/application/inventory-service';
import type { Failure, Result } from '../../src/domain/failures';
import { KeyedMutex } from '../../src/infrastructure/mutex';
import { InMemoryStore } from '../../src/infrastructure/store';
import { T0 } from './builders';
import { FakeClock } from './fake-clock';

export interface ServiceUnderTest {
  readonly service: InventoryService;
  readonly clock: FakeClock;
  readonly store: InMemoryStore;
}

export function makeService(
  options: { readonly locks?: LockManager; readonly holdTimeMs?: number } = {},
): ServiceUnderTest {
  const clock = new FakeClock(T0);
  const store = new InMemoryStore();
  const service = new InventoryService(
    store,
    options.locks ?? new KeyedMutex(),
    clock,
    options.holdTimeMs === undefined ? {} : { holdTimeMs: options.holdTimeMs },
  );
  return { service, clock, store };
}

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`Expected ok, got ${result.failure.code}: ${result.failure.message}`);
  }
  return result.value;
}

export function unwrapFailure(result: Result<unknown>): Failure {
  if (result.ok) {
    throw new Error('Expected a failure, got ok');
  }
  return result.failure;
}
