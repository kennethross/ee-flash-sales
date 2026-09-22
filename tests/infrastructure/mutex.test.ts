import { describe, expect, it } from 'vitest';
import { KeyedMutex, Mutex, NoLock } from '../../src/infrastructure/mutex';
import { tick } from '../support/timing';

/** A task that logs when it starts and ends, with a yield in between so others could interleave. */
function loggingTask(log: string[], name: string): () => Promise<string> {
  return async () => {
    log.push(`${name} start`);
    await tick();
    log.push(`${name} end`);
    return name;
  };
}

describe('Mutex', () => {
  it('runs tasks one at a time, in submission order', async () => {
    const mutex = new Mutex();
    const log: string[] = [];
    const results = await Promise.all([
      mutex.runExclusive(loggingTask(log, 'A')),
      mutex.runExclusive(loggingTask(log, 'B')),
      mutex.runExclusive(loggingTask(log, 'C')),
    ]);
    expect(log).toEqual(['A start', 'A end', 'B start', 'B end', 'C start', 'C end']);
    expect(results).toEqual(['A', 'B', 'C']);
  });

  it('without a mutex the same tasks interleave (control)', async () => {
    const log: string[] = [];
    await Promise.all([loggingTask(log, 'A')(), loggingTask(log, 'B')()]);
    expect(log).toEqual(['A start', 'B start', 'A end', 'B end']);
  });

  it('a task that throws neither blocks the next task nor swallows its error', async () => {
    const mutex = new Mutex();
    const failing = mutex.runExclusive(() => Promise.reject(new Error('boom')));
    const next = mutex.runExclusive(() => Promise.resolve('still running'));
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('still running');
  });
});

describe('KeyedMutex', () => {
  it('serialises tasks that share a key', async () => {
    const locks = new KeyedMutex();
    const log: string[] = [];
    await Promise.all([
      locks.withLock('sku-1', loggingTask(log, 'A')),
      locks.withLock('sku-1', loggingTask(log, 'B')),
    ]);
    expect(log).toEqual(['A start', 'A end', 'B start', 'B end']);
  });

  it('lets tasks with different keys overlap', async () => {
    const locks = new KeyedMutex();
    const log: string[] = [];
    await Promise.all([
      locks.withLock('sku-1', async () => {
        log.push('slow start');
        await tick();
        await tick();
        log.push('slow end');
      }),
      locks.withLock('sku-2', async () => {
        log.push('quick start');
        await tick();
        log.push('quick end');
      }),
    ]);
    expect(log).toEqual(['slow start', 'quick start', 'quick end', 'slow end']);
  });
});

describe('NoLock', () => {
  it('runs tasks immediately, so they interleave', async () => {
    const locks = new NoLock();
    const log: string[] = [];
    await Promise.all([
      locks.withLock('sku-1', loggingTask(log, 'A')),
      locks.withLock('sku-1', loggingTask(log, 'B')),
    ]);
    expect(log).toEqual(['A start', 'B start', 'A end', 'B end']);
  });
});
