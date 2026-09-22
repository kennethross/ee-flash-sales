import type { Clock } from '../../src/application/ports';

export class FakeClock implements Clock {
  #current: Date;

  constructor(start: Date) {
    this.#current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.#current.getTime());
  }

  advance(ms: number): void {
    this.#current = new Date(this.#current.getTime() + ms);
  }

  set(to: Date): void {
    this.#current = new Date(to.getTime());
  }
}
