import type { LockManager } from '../application/ports';

/**
 * A promise-chain mutex. `#tail` stands for the last task in the queue; a new task is chained
 * after it, so tasks run one at a time in submission order. The chain is kept settled-safe
 * (`then(noop, noop)`) so a task that rejects does not block the tasks behind it, while the
 * caller still receives that rejection through the returned promise.
 *
 * Nothing here blocks a thread: "waiting" is a promise that has not resolved yet.
 */
export class Mutex {
  #tail: Promise<void> = Promise.resolve();

  runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(task);
    this.#tail = result.then(noop, noop);
    return result;
  }
}

/** One Mutex per key, created on first use. Tasks with different keys never wait for each other. */
export class KeyedMutex implements LockManager {
  readonly #mutexes = new Map<string, Mutex>();

  withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    let mutex = this.#mutexes.get(key);
    if (mutex === undefined) {
      mutex = new Mutex();
      this.#mutexes.set(key, mutex);
    }
    return mutex.runExclusive(task);
  }
}

/** No locking at all. Exists so tests can show what goes wrong without the lock. */
export class NoLock implements LockManager {
  withLock<T>(_key: string, task: () => Promise<T>): Promise<T> {
    return task();
  }
}

function noop(): void {
  // intentionally empty
}
