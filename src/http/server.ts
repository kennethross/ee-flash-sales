import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { InventoryService } from '../application/inventory-service';
import { SystemClock } from '../infrastructure/clock';
import { KeyedMutex } from '../infrastructure/mutex';
import { InMemoryStore } from '../infrastructure/store';
import { createApp } from './app';

export interface RunningServer {
  readonly url: string;
  close(): Promise<void>;
}

/** Seeded at startup so the page has something to sell the moment it opens. */
export const DEMO_PRODUCT = {
  sku: 'flash-ticket',
  name: 'Flash Sale Ticket',
  totalStock: 1,
} as const;

export async function startServer(options: {
  readonly port: number;
  readonly publicDir?: string;
}): Promise<RunningServer> {
  const service = new InventoryService(new InMemoryStore(), new KeyedMutex(), new SystemClock());
  const seeded = await service.createProduct(DEMO_PRODUCT);
  if (!seeded.ok) {
    throw new Error(`Could not seed the demo product: ${seeded.failure.message}`);
  }

  const app = createApp(service);
  app.use('/*', serveStatic({ root: options.publicDir ?? './public' }));

  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: options.port }, (info) => {
      resolve({
        url: `http://localhost:${String(info.port)}`,
        close: () =>
          new Promise<void>((done, failClose) => {
            server.close((error) => {
              if (error) {
                failClose(error);
              } else {
                done();
              }
            });
          }),
      });
    });
    server.once('error', reject);
  });
}
