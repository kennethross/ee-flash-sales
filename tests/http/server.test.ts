import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_PRODUCT, startServer, type RunningServer } from '../../src/http/server';

let server: RunningServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('startServer', () => {
  it('listens on the given port, seeds the demo product and serves the API', async () => {
    server = await startServer({ port: 0 });
    expect(server.url).toMatch(/^http:\/\/localhost:\d+$/);
    const response = await fetch(`${server.url}/api/state`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { products: { sku: string; available: number }[] };
    expect(body.products).toEqual([
      { ...DEMO_PRODUCT, confirmed: 0, active: 0, available: 1, released: true, waiting: 0 },
    ]);
  });

  it('runs the waiting list every second: a release 1 s away is offered without anyone acting', async () => {
    server = await startServer({ port: 0 });
    const headers = { 'content-type': 'application/json' };
    const releaseAt = new Date(Date.now() + 1_000).toISOString();
    await fetch(`${server.url}/api/products`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sku: 'drop', name: 'Drop', totalStock: 1, releaseAt }),
    });
    await fetch(`${server.url}/api/products/drop/waitlist`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId: 'ana' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const state = (await (await fetch(`${server.url}/api/state`)).json()) as {
      waitlist: { state: string }[];
      reservations: { userId: string; state: string }[];
    };
    expect(state.waitlist[0]?.state).toBe('Offered');
    expect(state.reservations[0]).toMatchObject({ userId: 'ana', state: 'Active' });
  }, 10_000);

  it('serves the page at /', async () => {
    server = await startServer({ port: 0 });
    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<title>Flash Sale Simulator</title>');
  });
});
