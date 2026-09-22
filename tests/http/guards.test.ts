import { describe, expect, it } from 'vitest';
import {
  parseAdjustStock,
  parseCreateProduct,
  parseHoldTime,
  parseReserve,
} from '../../src/http/guards';
import { unwrapFailure } from '../support/service';

describe('parseCreateProduct', () => {
  it('accepts sku, name and totalStock', () => {
    expect(parseCreateProduct({ sku: 'mug', name: 'Mug', totalStock: 3 })).toEqual({
      ok: true,
      value: { sku: 'mug', name: 'Mug', totalStock: 3 },
    });
  });

  it.each([
    ['not an object', 'mug', 'Request body must be a JSON object.'],
    ['null', null, 'Request body must be a JSON object.'],
    ['an array', [], 'Request body must be a JSON object.'],
    ['a missing sku', { name: 'Mug', totalStock: 3 }, '"sku" must be a string.'],
    ['a numeric name', { sku: 'mug', name: 3, totalStock: 3 }, '"name" must be a string.'],
    [
      'a string totalStock',
      { sku: 'mug', name: 'Mug', totalStock: '3' },
      '"totalStock" must be a number.',
    ],
  ])('rejects %s with VALIDATION', (_label, body, message) => {
    const failure = unwrapFailure(parseCreateProduct(body));
    expect(failure.code).toBe('VALIDATION');
    expect(failure.message).toBe(message);
  });
});

describe('parseAdjustStock', () => {
  it('accepts totalStock', () => {
    expect(parseAdjustStock({ totalStock: 0 })).toEqual({ ok: true, value: { totalStock: 0 } });
  });

  it('rejects a missing totalStock', () => {
    expect(unwrapFailure(parseAdjustStock({})).message).toBe('"totalStock" must be a number.');
  });
});

describe('parseReserve', () => {
  it('accepts userId and quantity', () => {
    expect(parseReserve({ userId: 'ana', quantity: 2 })).toEqual({
      ok: true,
      value: { userId: 'ana', quantity: 2 },
    });
  });

  it('defaults quantity to 1', () => {
    expect(parseReserve({ userId: 'ana' })).toEqual({
      ok: true,
      value: { userId: 'ana', quantity: 1 },
    });
  });

  it('rejects a missing userId', () => {
    expect(unwrapFailure(parseReserve({})).message).toBe('"userId" must be a string.');
  });

  it('rejects a non-numeric quantity', () => {
    expect(unwrapFailure(parseReserve({ userId: 'ana', quantity: 'two' })).message).toBe(
      '"quantity" must be a number.',
    );
  });
});

describe('parseHoldTime', () => {
  it('accepts holdTimeMs', () => {
    expect(parseHoldTime({ holdTimeMs: 10_000 })).toEqual({
      ok: true,
      value: { holdTimeMs: 10_000 },
    });
  });

  it('rejects a missing holdTimeMs', () => {
    expect(unwrapFailure(parseHoldTime({})).message).toBe('"holdTimeMs" must be a number.');
  });
});
