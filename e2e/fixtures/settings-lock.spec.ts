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
