import { describe, expect, it } from 'vitest';
import { fail, ok, type Result } from '../../src/domain/failures';

describe('Result', () => {
  it('ok carries a value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('fail carries a code and a message', () => {
    expect(fail('OUT_OF_STOCK', 'Sold out')).toEqual({
      ok: false,
      failure: { code: 'OUT_OF_STOCK', message: 'Sold out' },
    });
  });

  it('narrows on the ok flag', () => {
    const results: Result<number>[] = [ok(1), fail('VALIDATION', 'bad')];
    const values = results.map((result) => (result.ok ? result.value : result.failure.code));
    expect(values).toEqual([1, 'VALIDATION']);
  });
});
