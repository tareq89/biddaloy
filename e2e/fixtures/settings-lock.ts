import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test as base } from './test';

/**
 * Cross-process lock for specs that change SCHOOL-WIDE settings (module switches, role-offs,
 * renamed words) on the one seeded school. `fullyParallel` + several workers would otherwise let
 * spec A's reset run while spec B has "Fines off" set. `describe.configure({ mode: 'serial' })`
 * only orders tests inside one file, and Playwright project dependencies would need a CI
 * workflow change, so this is a lock directory instead.
 *
 * Use: `import { test } from '../fixtures/settings-lock'` instead of `../fixtures/test`. Every
 * test then holds the lock for its own duration (auto fixture), so other files' tests wait.
 *
 * Key: the database name from DATABASE_URL (each `yarn test-env up` stack has its own, so two
 * stacks on one machine do not block each other); 'default' when it is not set.
 * Lock = `mkdir` (atomic) of `<tmpdir>/biddaloy-e2e-settings-<key>` holding `owner.json`.
 * Stale = owner pid dead, or older than 10 minutes: stolen via an atomic rename.
 * ponytail: stale-steal has a tiny window where a stealer can move a lock that was re-taken
 * in between; fine for a test lock, upgrade to a lock file with flock if it ever bites.
 */

const POLL_MIN_MS = 50;
const POLL_JITTER_MS = 200;

export interface LockOptions {
  key?: string;
  timeoutMs?: number;
  staleMs?: number;
}

function defaultKey(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1) || 'default';
  } catch {
    return 'default';
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class SchoolSettingsLock {
  private readonly dir: string;
  private readonly timeoutMs: number;
  private readonly staleMs: number;
  private readonly token = randomUUID();
  private depth = 0;

  constructor(opts: LockOptions = {}) {
    this.dir = join(tmpdir(), `biddaloy-e2e-settings-${opts.key ?? defaultKey()}`);
    this.timeoutMs = opts.timeoutMs ?? 5 * 60_000;
    this.staleMs = opts.staleMs ?? 10 * 60_000;
  }

  private isStale(): boolean {
    try {
      const owner = JSON.parse(readFileSync(join(this.dir, 'owner.json'), 'utf8')) as {
        pid: number;
        startedAt: number;
      };
      return !alive(owner.pid) || Date.now() - owner.startedAt > this.staleMs;
    } catch {
      // Dir exists but owner.json is not written yet (or unreadable): judge by the dir's age.
      try {
        return Date.now() - statSync(this.dir).mtimeMs > this.staleMs;
      } catch {
        return false; // gone already
      }
    }
  }

  private tryTake(): boolean {
    try {
      mkdirSync(this.dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (this.isStale()) {
        const trash = `${this.dir}.stale-${this.token}`;
        try {
          renameSync(this.dir, trash);
          rmSync(trash, { recursive: true, force: true });
        } catch {
          /* someone else stole it first */
        }
      }
      return false;
    }
    writeFileSync(
      join(this.dir, 'owner.json'),
      JSON.stringify({ pid: process.pid, token: this.token, startedAt: Date.now() }),
    );
    return true;
  }

  /** Re-entrant within this instance. Polls with jitter; fails after `timeoutMs`. */
  async acquire(): Promise<void> {
    if (this.depth > 0) {
      this.depth++;
      return;
    }
    const deadline = Date.now() + this.timeoutMs;
    while (!this.tryTake()) {
      if (Date.now() > deadline) {
        throw new Error(
          `school-settings lock still held after ${Math.round(this.timeoutMs / 1000)}s (${this.dir}); ` +
            'another spec that changes school-wide settings is stuck, or delete that directory.',
        );
      }
      await new Promise((r) => setTimeout(r, POLL_MIN_MS + Math.random() * POLL_JITTER_MS));
    }
    this.depth = 1;
  }

  /** Removes the lock only if this instance owns it. A release without a hold is a no-op. */
  release(): void {
    if (this.depth === 0) return;
    if (--this.depth > 0) return;
    try {
      const owner = JSON.parse(readFileSync(join(this.dir, 'owner.json'), 'utf8')) as {
        token: string;
      };
      if (owner.token === this.token) rmSync(this.dir, { recursive: true, force: true });
    } catch {
      /* already stolen or removed */
    }
  }

  /** Safety net: drop every hold at once (worker exit). */
  releaseAll(): void {
    if (this.depth > 0) {
      this.depth = 1;
      this.release();
    }
  }
}

const shared = new SchoolSettingsLock();
process.once('exit', () => shared.releaseAll());

export async function withSchoolSettingsLock<T>(fn: () => Promise<T>): Promise<T> {
  await shared.acquire();
  try {
    return await fn();
  } finally {
    shared.release();
  }
}

/**
 * `test` with an auto fixture holding the lock for each test. The fixture's own timeout covers
 * the wait (it does not eat the test's timeout).
 */
export const test = base.extend<{ schoolSettingsLock: void }>({
  schoolSettingsLock: [
    async ({}, use) => {
      await shared.acquire();
      try {
        await use();
      } finally {
        shared.release();
      }
    },
    { auto: true, timeout: 5 * 60_000 + 30_000 },
  ],
});
