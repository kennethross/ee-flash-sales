import { startServer } from './http/server';

const port = Number(process.env.PORT ?? '3000');
const server = await startServer({ port });
console.log(`Inventory reservation service: ${server.url}`);

// Stop accepting connections, let in-flight requests finish, then exit.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void server.close().then(() => {
      process.exit(0);
    });
  });
}
