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

  it('serves the page at /', async () => {
    server = await startServer({ port: 0 });
    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<title>Flash Sale Simulator</title>');
  });
});
