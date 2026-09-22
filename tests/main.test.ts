import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

/** Resolves with the first `http://localhost:<port>` the child prints. */
function waitForUrl(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    stream.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /http:\/\/localhost:\d+/.exec(output);
      if (match) {
        resolve(match[0]);
      }
    });
    stream.on('end', () => {
      reject(new Error(`The entry point exited before printing its URL:\n${output}`));
    });
  });
}

describe('npm start entry point', () => {
  it('boots on the given port, serves the API, and exits cleanly on SIGTERM', async () => {
    const child = spawn('node_modules/.bin/tsx', ['src/main.ts'], {
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      const url = await waitForUrl(child.stdout);
      const response = await fetch(`${url}/api/state`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { products: { sku: string }[] };
      expect(body.products[0]?.sku).toBe('flash-ticket');
    } finally {
      child.kill('SIGTERM');
    }
    const [code] = (await once(child, 'exit')) as [number | null, string | null];
    expect(code).toBe(0);
  }, 20_000);
});
