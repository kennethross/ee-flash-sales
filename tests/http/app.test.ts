import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { InventoryService, type Snapshot } from '../../src/application/inventory-service';
import { createApp } from '../../src/http/app';
import { KeyedMutex } from '../../src/infrastructure/mutex';
import { InMemoryStore } from '../../src/infrastructure/store';
import { HOLD_MS, T0, at } from '../support/builders';
import { FakeClock } from '../support/fake-clock';
import { makeService, type ServiceUnderTest } from '../support/service';

interface Response<T> {
  readonly status: number;
  readonly body: T;
}

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

async function call<T>(
  app: Hono,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response<T>> {
  const response = await app.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: (text === '' ? undefined : JSON.parse(text)) as T };
}

function setup(): ServiceUnderTest & { app: Hono } {
  const sut = makeService();
  return { ...sut, app: createApp(sut.service) };
}

const ticket = { sku: 'flash-ticket', name: 'Flash Sale Ticket', totalStock: 1 };

describe('R11 — POST /api/products', () => {
  it('creates a product: 201 with its view', async () => {
    const { app } = setup();
    const response = await call<unknown>(app, 'POST', '/api/products', ticket);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      ...ticket,
      confirmed: 0,
      active: 0,
      available: 1,
      released: true,
      waiting: 0,
    });
  });

  it('duplicate sku: 409 ALREADY_EXISTS', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    const response = await call<ErrorBody>(app, 'POST', '/api/products', ticket);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ALREADY_EXISTS');
  });

  it('bad shape: 400 VALIDATION', async () => {
    const { app } = setup();
    const response = await call<ErrorBody>(app, 'POST', '/api/products', { sku: 'x' });
    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION',
      message: '"name" must be a string.',
    });
  });

  it('malformed JSON: 400 VALIDATION', async () => {
    const { app } = setup();
    const response = await app.request('/api/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(response.status).toBe(400);
  });
});

describe('R11 — PATCH and DELETE /api/products/:sku', () => {
  it('PATCH sets the total: 200 with the view', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    const response = await call<unknown>(app, 'PATCH', '/api/products/flash-ticket', {
      totalStock: 4,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ...ticket,
      totalStock: 4,
      confirmed: 0,
      active: 0,
      available: 4,
      released: true,
      waiting: 0,
    });
  });

  it('PATCH unknown sku: 404', async () => {
    const { app } = setup();
    const response = await call<ErrorBody>(app, 'PATCH', '/api/products/nope', { totalStock: 4 });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('PATCH below the floor: 400', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    await call(app, 'POST', '/api/products/flash-ticket/reservations', { userId: 'ana' });
    const response = await call<ErrorBody>(app, 'PATCH', '/api/products/flash-ticket', {
      totalStock: 0,
    });
    expect(response.status).toBe(400);
  });

  it('DELETE: 204 with no body, then 404', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    const first = await call<undefined>(app, 'DELETE', '/api/products/flash-ticket');
    expect(first.status).toBe(204);
    expect(first.body).toBeUndefined();
    expect((await call(app, 'DELETE', '/api/products/flash-ticket')).status).toBe(404);
  });
});

describe('R11 — POST /api/products/:sku/reservations', () => {
  it('reserves: 201 with the reservation, dates as ISO strings', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    const response = await call<{ state: string; expiresAt: string; quantity: number }>(
      app,
      'POST',
      '/api/products/flash-ticket/reservations',
      { userId: 'ana' },
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      sku: 'flash-ticket',
      userId: 'ana',
      quantity: 1,
      state: 'Active',
      expiresAt: at(HOLD_MS).toISOString(),
    });
  });

  it('sold out: 409 OUT_OF_STOCK', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    await call(app, 'POST', '/api/products/flash-ticket/reservations', { userId: 'ana' });
    const response = await call<ErrorBody>(app, 'POST', '/api/products/flash-ticket/reservations', {
      userId: 'ben',
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('OUT_OF_STOCK');
  });

  it('unknown product: 404', async () => {
    const { app } = setup();
    const response = await call(app, 'POST', '/api/products/nope/reservations', { userId: 'ana' });
    expect(response.status).toBe(404);
  });

  it('missing userId: 400', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    const response = await call(app, 'POST', '/api/products/flash-ticket/reservations', {});
    expect(response.status).toBe(400);
  });

  it('R9 over HTTP — 500 concurrent requests for the last item: one 201, 499 × 409', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    const responses = await Promise.all(
      Array.from({ length: 500 }, (_, i) =>
        call<ErrorBody>(app, 'POST', '/api/products/flash-ticket/reservations', {
          userId: `user-${String(i)}`,
        }),
      ),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(499);
  });
});

describe('R11 — POST /api/reservations/:id/confirm and /cancel', () => {
  async function reserved(app: Hono): Promise<string> {
    await call(app, 'POST', '/api/products', ticket);
    const response = await call<{ id: string }>(
      app,
      'POST',
      '/api/products/flash-ticket/reservations',
      {
        userId: 'ana',
      },
    );
    return response.body.id;
  }

  it('confirm: 200 Confirmed, then 409 INVALID_STATE', async () => {
    const { app } = setup();
    const id = await reserved(app);
    const first = await call<{ state: string }>(app, 'POST', `/api/reservations/${id}/confirm`);
    expect(first.status).toBe(200);
    expect(first.body.state).toBe('Confirmed');
    const second = await call<ErrorBody>(app, 'POST', `/api/reservations/${id}/confirm`);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('INVALID_STATE');
  });

  it('cancel: 200 Cancelled', async () => {
    const { app } = setup();
    const id = await reserved(app);
    const response = await call<{ state: string }>(app, 'POST', `/api/reservations/${id}/cancel`);
    expect(response.status).toBe(200);
    expect(response.body.state).toBe('Cancelled');
  });

  it('unknown reservation: 404', async () => {
    const { app } = setup();
    expect((await call(app, 'POST', '/api/reservations/nope/confirm')).status).toBe(404);
    expect((await call(app, 'POST', '/api/reservations/nope/cancel')).status).toBe(404);
  });
});

describe('R11 — PUT /api/settings/hold-time', () => {
  it('sets the hold time: 200', async () => {
    const { app, service } = setup();
    const response = await call<unknown>(app, 'PUT', '/api/settings/hold-time', {
      holdTimeMs: 10_000,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ holdTimeMs: 10_000 });
    expect(service.holdTimeMs).toBe(10_000);
  });

  it('rejects zero: 400', async () => {
    const { app } = setup();
    expect((await call(app, 'PUT', '/api/settings/hold-time', { holdTimeMs: 0 })).status).toBe(400);
  });
});

describe('R11 — GET /api/state', () => {
  it('returns now, hold time, product views, reservations and events with ISO dates', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    await call(app, 'POST', '/api/products/flash-ticket/reservations', { userId: 'ana' });
    const response = await call<{
      now: string;
      holdTimeMs: number;
      products: unknown[];
      reservations: { expiresAt: string }[];
      events: { seq: number; at: string; type: string; actor: string; message: string }[];
    }>(app, 'GET', '/api/state');
    expect(response.status).toBe(200);
    expect(response.body.now).toBe('2026-09-22T10:00:00.000Z');
    expect(response.body.holdTimeMs).toBe(HOLD_MS);
    expect(response.body.products).toEqual([
      { ...ticket, confirmed: 0, active: 1, available: 0, released: true, waiting: 0 },
    ]);
    expect(response.body.reservations[0]?.expiresAt).toBe(at(HOLD_MS).toISOString());
    expect(response.body.events.map((event) => [event.type, event.actor])).toEqual([
      ['product-created', 'inventory'],
      ['reserved', 'ana'],
    ]);
    expect(response.body.events[1]?.at).toBe('2026-09-22T10:00:00.000Z');
  });
});

describe('R12 — POST /api/reset', () => {
  it('returns the inventory to the seed the app was built with', async () => {
    const sut = makeService();
    const app = createApp(sut.service, { seed: [ticket] });
    await call(app, 'POST', '/api/products', { sku: 'mug', name: 'Mug', totalStock: 2 });
    await call(app, 'POST', '/api/products/mug/reservations', { userId: 'ana' });
    await call(app, 'PUT', '/api/settings/hold-time', { holdTimeMs: 5_000 });

    const response = await call<{
      holdTimeMs: number;
      products: unknown[];
      reservations: unknown[];
      events: { type: string }[];
    }>(app, 'POST', '/api/reset');

    expect(response.status).toBe(200);
    expect(response.body.holdTimeMs).toBe(HOLD_MS);
    expect(response.body.products).toEqual([
      { ...ticket, confirmed: 0, active: 0, available: 1, released: true, waiting: 0 },
    ]);
    expect(response.body.reservations).toEqual([]);
    expect(response.body.events.map((event) => event.type)).toEqual(['reset', 'product-created']);
  });

  it('with no seed configured leaves an empty inventory', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', ticket);
    const response = await call<{ products: unknown[] }>(app, 'POST', '/api/reset');
    expect(response.status).toBe(200);
    expect(response.body.products).toEqual([]);
  });
});

describe('GET /api/health', () => {
  it('answers ok for load balancers and container health checks', async () => {
    const { app } = setup();
    const response = await call<{ status: string }>(app, 'GET', '/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('reports the version the app was built with, so a deployment can be checked', async () => {
    const sut = makeService();
    const app = createApp(sut.service, { version: '9.9.9' });
    const response = await call<{ status: string; version: string }>(app, 'GET', '/api/health');
    expect(response.body).toEqual({ status: 'ok', version: '9.9.9' });
  });
});

describe('unknown routes', () => {
  it('answer 404 as JSON', async () => {
    const { app } = setup();
    const response = await call<ErrorBody>(app, 'GET', '/api/nothing');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('R14–R18 over HTTP — coming-soon products and the waiting list', () => {
  const releaseAt = at(60_000).toISOString();
  const drop = { sku: 'drop', name: 'Limited Drop', totalStock: 1, releaseAt };

  it('creates a coming-soon product: released false, releaseAt as ISO', async () => {
    const { app } = setup();
    const response = await call<{ released: boolean; releaseAt: string }>(
      app,
      'POST',
      '/api/products',
      drop,
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ released: false, releaseAt, waiting: 0 });
  });

  it('reserve before release: 409 NOT_RELEASED', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', drop);
    const response = await call<ErrorBody>(app, 'POST', '/api/products/drop/reservations', {
      userId: 'ana',
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('NOT_RELEASED');
  });

  it('join: 201 with the position; again: 409 ALREADY_QUEUED', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', drop);
    const first = await call<{ userId: string; state: string; position: number }>(
      app,
      'POST',
      '/api/products/drop/waitlist',
      { userId: 'ana' },
    );
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ userId: 'ana', state: 'Waiting', position: 1 });
    const again = await call<ErrorBody>(app, 'POST', '/api/products/drop/waitlist', {
      userId: 'ana',
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_QUEUED');
  });

  it('join validates the body and the product', async () => {
    const { app } = setup();
    expect((await call(app, 'POST', '/api/products/nope/waitlist', { userId: 'ana' })).status).toBe(
      404,
    );
    await call(app, 'POST', '/api/products', drop);
    expect((await call(app, 'POST', '/api/products/drop/waitlist', {})).status).toBe(400);
  });

  it('PATCH releaseAt to null releases the product and offers the first in line', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', drop);
    await call(app, 'POST', '/api/products/drop/waitlist', { userId: 'ana' });
    const response = await call<{ released: boolean; active: number; waiting: number }>(
      app,
      'PATCH',
      '/api/products/drop',
      { releaseAt: null },
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ released: true, active: 1, waiting: 0 });
  });

  it('PATCH with both totalStock and releaseAt applies both', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', drop);
    const response = await call<{ totalStock: number; releaseAt: string }>(
      app,
      'PATCH',
      '/api/products/drop',
      {
        totalStock: 5,
        releaseAt: at(1_000).toISOString(),
      },
    );
    expect(response.body).toMatchObject({ totalStock: 5, releaseAt: at(1_000).toISOString() });
  });

  it('PATCH with nothing to change: 400', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', drop);
    expect((await call(app, 'PATCH', '/api/products/drop', {})).status).toBe(400);
  });

  it('leave: 204, then 404', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', drop);
    const joined = await call<{ id: string }>(app, 'POST', '/api/products/drop/waitlist', {
      userId: 'ana',
    });
    expect((await call(app, 'DELETE', `/api/waitlist/${joined.body.id}`)).status).toBe(204);
    expect((await call(app, 'DELETE', `/api/waitlist/${joined.body.id}`)).status).toBe(409);
    expect((await call(app, 'DELETE', '/api/waitlist/nope')).status).toBe(404);
  });

  it('GET /api/state carries the waiting list with positions', async () => {
    const { app } = setup();
    await call(app, 'POST', '/api/products', drop);
    await call(app, 'POST', '/api/products/drop/waitlist', { userId: 'ana' });
    await call(app, 'POST', '/api/products/drop/waitlist', { userId: 'ben' });
    const response = await call<{
      waitlist: { userId: string; position: number; joinedAt: string }[];
    }>(app, 'GET', '/api/state');
    expect(response.body.waitlist.map((e) => [e.userId, e.position])).toEqual([
      ['ana', 1],
      ['ben', 2],
    ]);
    expect(response.body.waitlist[0]?.joinedAt).toBe(T0.toISOString());
  });
});

describe('unexpected errors', () => {
  class BrokenService extends InventoryService {
    override snapshot(): Promise<Snapshot> {
      return Promise.reject(new Error('boom: a bug, not a domain failure'));
    }
  }

  it('answer 500 as JSON without leaking the error, and report it', async () => {
    const reported: unknown[] = [];
    const broken = new BrokenService(new InMemoryStore(), new KeyedMutex(), new FakeClock(T0));
    const app = createApp(broken, { reportError: (error) => reported.push(error) });
    const response = await call<ErrorBody>(app, 'GET', '/api/state');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong on our side.' },
    });
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(Error);
  });
});
