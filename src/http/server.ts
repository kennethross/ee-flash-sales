import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import pkg from '../../package.json' with { type: 'json' };
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

/** How often the waiting lists are run: release times and expired offers are noticed within this. */
const SWEEP_INTERVAL_MS = 1_000;

export async function startServer(options: {
  readonly port: number;
  readonly publicDir?: string;
}): Promise<RunningServer> {
  const service = new InventoryService(new InMemoryStore(), new KeyedMutex(), new SystemClock());
  const seeded = await service.createProduct(DEMO_PRODUCT);
  if (!seeded.ok) {
    throw new Error(`Could not seed the demo product: ${seeded.failure.message}`);
  }

  // The version is inlined at build time (esbuild) or read by tsx in development: one source, package.json.
  const app = createApp(service, { seed: [DEMO_PRODUCT], version: pkg.version });
  app.use('/*', serveStatic({ root: options.publicDir ?? './public' }));

  // One interval for the whole process, not a timer per entry; restarting resumes from state.
  const sweeper = setInterval(() => {
    service.processWaitlists().catch((error: unknown) => {
      console.error('Waiting-list sweep failed:', error);
    });
  }, SWEEP_INTERVAL_MS);

  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: options.port }, (info) => {
      resolve({
        url: `http://localhost:${String(info.port)}`,
        close: () =>
          new Promise<void>((done, failClose) => {
            clearInterval(sweeper);
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
    server.once('error', (error: unknown) => {
      clearInterval(sweeper);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}
