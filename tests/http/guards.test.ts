import { describe, expect, it } from 'vitest';
import {
  parseCreateProduct,
  parseHoldTime,
  parseJoinWaitlist,
  parseReserve,
  parseUpdateProduct,
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

describe('parseCreateProduct with a release time', () => {
  it('accepts an ISO releaseAt', () => {
    expect(
      parseCreateProduct({
        sku: 'drop',
        name: 'Drop',
        totalStock: 1,
        releaseAt: '2026-10-01T00:00:00.000Z',
      }),
    ).toEqual({
      ok: true,
      value: {
        sku: 'drop',
        name: 'Drop',
        totalStock: 1,
        releaseAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
  });

  it('rejects a releaseAt that is not an ISO date-time', () => {
    const failure = unwrapFailure(
      parseCreateProduct({ sku: 'drop', name: 'Drop', totalStock: 1, releaseAt: 'midnight' }),
    );
    expect(failure.message).toBe('"releaseAt" must be an ISO 8601 date-time.');
  });
});

describe('parseUpdateProduct', () => {
  it('accepts totalStock alone', () => {
    expect(parseUpdateProduct({ totalStock: 0 })).toEqual({ ok: true, value: { totalStock: 0 } });
  });

  it('accepts releaseAt alone, as a date or null to clear it', () => {
    expect(parseUpdateProduct({ releaseAt: '2026-10-01T00:00:00.000Z' })).toEqual({
      ok: true,
      value: { releaseAt: new Date('2026-10-01T00:00:00.000Z') },
    });
    expect(parseUpdateProduct({ releaseAt: null })).toEqual({
      ok: true,
      value: { releaseAt: null },
    });
  });

  it('accepts both together', () => {
    expect(parseUpdateProduct({ totalStock: 2, releaseAt: null })).toEqual({
      ok: true,
      value: { totalStock: 2, releaseAt: null },
    });
  });

  it('rejects an empty update', () => {
    expect(unwrapFailure(parseUpdateProduct({})).message).toBe(
      'Provide "totalStock" and/or "releaseAt".',
    );
  });

  it('rejects a non-numeric totalStock', () => {
    expect(unwrapFailure(parseUpdateProduct({ totalStock: '3' })).message).toBe(
      '"totalStock" must be a number.',
    );
  });
});

describe('parseJoinWaitlist', () => {
  it('accepts a userId', () => {
    expect(parseJoinWaitlist({ userId: 'ana' })).toEqual({ ok: true, value: { userId: 'ana' } });
  });

  it('rejects a missing userId', () => {
    expect(unwrapFailure(parseJoinWaitlist({})).message).toBe('"userId" must be a string.');
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
