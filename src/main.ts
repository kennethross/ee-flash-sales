import { startServer } from './http/server';

const port = Number(process.env.PORT ?? '3000');
const server = await startServer({ port });
console.log(`Inventory reservation service: ${server.url}`);
