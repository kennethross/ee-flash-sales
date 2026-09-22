import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { CreateProductInput, InventoryService } from '../application/inventory-service';
import type { FailureCode, Result } from '../domain/failures';
import { parseAdjustStock, parseCreateProduct, parseHoldTime, parseReserve } from './guards';

/** The one place a failure code becomes an HTTP status. */
const STATUS_BY_CODE: Record<FailureCode, ContentfulStatusCode> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  OUT_OF_STOCK: 409,
  INVALID_STATE: 409,
  ALREADY_EXISTS: 409,
};

export interface AppOptions {
  /** Where unexpected errors (bugs, not domain failures) are reported. Defaults to `console.error`. */
  readonly reportError?: (error: unknown) => void;
  /** What `POST /api/reset` re-creates after clearing everything. Defaults to nothing. */
  readonly seed?: readonly CreateProductInput[];
}

/** Routes only: no listening, no static files, so tests can call it in-process. */
export function createApp(service: InventoryService, options: AppOptions = {}): Hono {
  const app = new Hono();
  const reportError = options.reportError ?? defaultReportError;
  const seed = options.seed ?? [];

  app.post('/api/products', async (c) => {
    const parsed = parseCreateProduct(await readJson(c));
    if (!parsed.ok) {
      return respond(c, parsed);
    }
    return respond(c, await service.createProduct(parsed.value), 201);
  });

  app.patch('/api/products/:sku', async (c) => {
    const parsed = parseAdjustStock(await readJson(c));
    if (!parsed.ok) {
      return respond(c, parsed);
    }
    return respond(c, await service.adjustStock(c.req.param('sku'), parsed.value.totalStock));
  });

  app.delete('/api/products/:sku', async (c) => {
    const result = await service.deleteProduct(c.req.param('sku'));
    return result.ok ? c.body(null, 204) : respond(c, result);
  });

  app.post('/api/products/:sku/reservations', async (c) => {
    const parsed = parseReserve(await readJson(c));
    if (!parsed.ok) {
      return respond(c, parsed);
    }
    const { userId, quantity } = parsed.value;
    return respond(c, await service.reserve(c.req.param('sku'), userId, quantity), 201);
  });

  app.post('/api/reservations/:id/confirm', async (c) =>
    respond(c, await service.confirm(c.req.param('id'))),
  );

  app.post('/api/reservations/:id/cancel', async (c) =>
    respond(c, await service.cancel(c.req.param('id'))),
  );

  app.put('/api/settings/hold-time', async (c) => {
    const parsed = parseHoldTime(await readJson(c));
    if (!parsed.ok) {
      return respond(c, parsed);
    }
    const result = await service.setHoldTime(parsed.value.holdTimeMs);
    return result.ok ? c.json({ holdTimeMs: result.value }) : respond(c, result);
  });

  app.get('/api/state', async (c) => c.json(await service.snapshot()));

  app.post('/api/reset', async (c) => respond(c, await service.reset(seed)));

  app.notFound((c) =>
    c.json(
      { error: { code: 'NOT_FOUND', message: `No route for ${c.req.method} ${c.req.path}` } },
      404,
    ),
  );

  // Domain failures are Result values and never reach here; anything thrown is a bug. The client
  // gets the same error shape as everywhere else, with nothing about the internals.
  app.onError((error, c) => {
    reportError(error);
    return c.json(
      { error: { code: 'INTERNAL', message: 'Something went wrong on our side.' } },
      500,
    );
  });

  return app;
}

function defaultReportError(error: unknown): void {
  console.error('Unexpected error while handling a request:', error);
}

/** Malformed JSON becomes `undefined`, which the guards reject as "not an object". */
async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch {
    return undefined;
  }
}

function respond(
  c: Context,
  result: Result<unknown>,
  okStatus: ContentfulStatusCode = 200,
): Response {
  return result.ok
    ? c.json(result.value, okStatus)
    : c.json({ error: result.failure }, STATUS_BY_CODE[result.failure.code]);
}
