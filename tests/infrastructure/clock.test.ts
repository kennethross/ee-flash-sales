import { describe, expect, it } from 'vitest';
import { SystemClock } from '../../src/infrastructure/clock';
import { T0 } from '../support/builders';
import { FakeClock } from '../support/fake-clock';

describe('SystemClock', () => {
  it('reports the current time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe('FakeClock', () => {
  it('starts where told, advances, and hands out copies', () => {
    const clock = new FakeClock(T0);
    const first = clock.now();
    clock.advance(1_000);
    expect(first.getTime()).toBe(T0.getTime());
    expect(clock.now().getTime()).toBe(T0.getTime() + 1_000);
    clock.set(T0);
    expect(clock.now().getTime()).toBe(T0.getTime());
  });
});
