import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { SchoolSettingsLock } from './settings-lock';

// No app needed: each test uses its own key, so it never touches the real lock.
const key = () => `unit-${process.pid}-${Math.random().toString(36).slice(2)}`;

test('two acquirers never overlap', async () => {
  const k = key();
  let inside = 0;
  let maxInside = 0;
  const run = async () => {
    const lock = new SchoolSettingsLock({ key: k });
    await lock.acquire();
    inside++;
    maxInside = Math.max(maxInside, inside);
    await new Promise((r) => setTimeout(r, 120));
    inside--;
    lock.release();
  };
  await Promise.all([run(), run(), run()]);
  expect(maxInside).toBe(1);
});

test('a lock whose owner pid is dead is stolen', async () => {
  const k = key();
  const dead = spawnSync(process.execPath, ['-e', '0']).pid!;
  const dir = join(tmpdir(), `biddaloy-e2e-settings-${k}`);
  mkdirSync(dir);
  writeFileSync(
    join(dir, 'owner.json'),
    JSON.stringify({ pid: dead, token: 'x', startedAt: Date.now() }),
  );
  const lock = new SchoolSettingsLock({ key: k, timeoutMs: 2000 });
  await lock.acquire();
  lock.release();
});

test('a live lock times out with a clear message; double release is a no-op', async () => {
  const k = key();
  const holder = new SchoolSettingsLock({ key: k });
  await holder.acquire();
  const waiter = new SchoolSettingsLock({ key: k, timeoutMs: 400 });
  await expect(waiter.acquire()).rejects.toThrow(/school-settings lock still held/);
  waiter.release(); // never held: must not remove the holder's lock
  await expect(new SchoolSettingsLock({ key: k, timeoutMs: 200 }).acquire()).rejects.toThrow();
  holder.release();
  holder.release();
  await new SchoolSettingsLock({ key: k, timeoutMs: 200 }).acquire();
});

test('re-entrant within one instance', async () => {
  const lock = new SchoolSettingsLock({ key: key(), timeoutMs: 300 });
  await lock.acquire();
  await lock.acquire();
  lock.release();
  lock.release();
});

test('readers share; a writer waits for them and new readers wait for the writer', async () => {
  const k = key();
  const log: string[] = [];
  const reader = (name: string, ms: number) => async () => {
    const l = new SchoolSettingsLock({ key: k });
    await l.acquireShared();
    log.push(`${name}+`);
    await new Promise((r) => setTimeout(r, ms));
    log.push(`${name}-`);
    l.releaseShared();
  };
  const r1 = reader('r1', 300)();
  const r2 = reader('r2', 300)();
  await new Promise((r) => setTimeout(r, 100));
  const w = new SchoolSettingsLock({ key: k });
  const writer = (async () => {
    await w.acquire();
    log.push('w+');
    await new Promise((r) => setTimeout(r, 100));
    log.push('w-');
    w.release();
  })();
  await new Promise((r) => setTimeout(r, 100));
  const r3 = reader('r3', 10)();
  await Promise.all([r1, r2, writer, r3]);
  expect(log.slice(0, 2).sort()).toEqual(['r1+', 'r2+']); // readers overlapped
  expect(log.indexOf('w+')).toBeGreaterThan(log.indexOf('r1-')); // writer after both readers left
  expect(log.indexOf('w+')).toBeGreaterThan(log.indexOf('r2-'));
  expect(log.indexOf('r3+')).toBeGreaterThan(log.indexOf('w-')); // late reader behind the writer
});
