import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Server { url: string; dataDir: string; stop: () => void; proc: ChildProcess }

export async function startServer(port: number, env: Record<string, string>): Promise<Server> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mechdeck-test-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, LOG_LEVEL: 'warn', ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${url}/api/me`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  return { url, dataDir, proc, stop: () => { proc.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

export function client(base: string) {
  return async (p: string, opts: { method?: string; body?: unknown; form?: FormData } = {}) => {
    const res = await fetch(base + p, {
      method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    });
    return { status: res.status, data: await res.json().catch(() => null) as any };
  };
}
