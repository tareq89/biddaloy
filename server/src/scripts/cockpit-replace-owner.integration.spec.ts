import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import * as fs from 'fs';
import * as path from 'path';
import {
  replaceOwner,
  validateReplaceInput,
  REPLACE_OWNER_LOCK_KEY,
  operatorName,
} from './cockpit-replace-owner';

describe('cockpit-replace-owner (integration)', () => {
  let ds: DataSource;
  const tag = `${process.pid}-${Date.now()}`;
  const mail = (name: string) => `replace-owner-${name}-${tag}@example.com`;
  // Distinct E.164 numbers per user, unique per run.
  const base = 1_000_000_000 + (process.pid % 1000) * 100_000;
  const phone = (n: number) => `+8801${base + n}`;
  const created: string[] = [];

  async function makeOwner(name: string, n: number, status = 'ACTIVE'): Promise<string> {
    const [row] = await ds.query(
      `INSERT INTO users (email, phone, full_name, status) VALUES ($1, $2, 'Owner', $3) RETURNING id`,
      [mail(name), phone(n), status],
    );
    await ds.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [row.id]);
    created.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  });

  afterAll(async () => {
    // audit_logs is append-only and has no FK to these users, so only owners and users go.
    await ds.query(`DELETE FROM platform_admins WHERE user_id = ANY($1)`, [created]);
    await ds.query(`DELETE FROM users WHERE id = ANY($1)`, [created]);
  });

  it('replaces an owner: new owner added, old suspended, MFA gone, sessions cut, audit written', async () => {
    const oldId = await makeOwner('old', 1);
    const keepId = await makeOwner('keep', 2);
    await ds.query(`INSERT INTO user_mfa (user_id, secret_enc) VALUES ($1, 'enc')`, [oldId]);

    const logs = console.log;
    const outputs: string[] = [];
    console.log = (...a: unknown[]) => outputs.push(a.join(' '));
    let result;
    try {
      result = await replaceOwner(ds, {
        oldEmail: mail('old'),
        newEmail: mail('new'),
        newPhone: phone(3),
      });
    } finally {
      console.log = logs;
    }
    created.push(result.newUserId);

    expect(result.oldUserId).toBe(oldId);
    const [old] = await ds.query(`SELECT status, tokens_valid_after FROM users WHERE id = $1`, [
      oldId,
    ]);
    expect(old.status).toBe('SUSPENDED');
    // Rule 8: a suspend cuts the old access tokens off.
    expect(old.tokens_valid_after).not.toBeNull();
    expect(await ds.query(`SELECT 1 FROM user_mfa WHERE user_id = $1`, [oldId])).toHaveLength(0);
    expect(
      await ds.query(`SELECT 1 FROM platform_admins WHERE user_id = $1`, [result.newUserId]),
    ).toHaveLength(1);
    expect(
      await ds.query(`SELECT 1 FROM platform_admins WHERE user_id = $1`, [keepId]),
    ).toHaveLength(1);

    // Audit row: platform scope (tenant NULL), user ids only.
    const [audit] = await ds.query(
      `SELECT tenant_id, old_values, new_values FROM audit_logs
       WHERE action = 'PLATFORM_OWNER_REPLACED' AND entity_id = $1`,
      [result.newUserId],
    );
    expect(audit.tenant_id).toBeNull();
    expect(audit.new_values.operator).toBe(operatorName());
    const text = JSON.stringify(audit) + outputs.join('\n');
    expect(text).not.toContain('@example.com');
    expect(text).not.toContain(phone(1));
    expect(text).not.toContain(phone(3));
  });

  it('refuses when the old email is not an owner, without echoing it', async () => {
    await makeOwner('a', 11);
    await makeOwner('b', 12);
    const run = replaceOwner(ds, {
      oldEmail: mail('stranger'),
      newEmail: mail('n2'),
      newPhone: phone(13),
    });
    await expect(run).rejects.toThrow(/not a platform owner/);
    await expect(run).rejects.not.toThrow(mail('stranger'));
  });

  it('refuses an existing new user that is not ACTIVE, without creating an owner row', async () => {
    await makeOwner('sus-a', 41);
    await makeOwner('sus-b', 42);
    const [sus] = await ds.query(
      `INSERT INTO users (email, phone, full_name, status) VALUES ($1, $2, 'Gone', 'SUSPENDED') RETURNING id`,
      [mail('sus-new'), phone(43)],
    );
    created.push(sus.id);
    await expect(
      replaceOwner(ds, {
        oldEmail: mail('sus-a'),
        newEmail: mail('sus-new'),
        newPhone: phone(43),
      }),
    ).rejects.toThrow(/not active/);
    expect(
      await ds.query(`SELECT 1 FROM platform_admins WHERE user_id = $1`, [sus.id]),
    ).toHaveLength(0);
  });

  it('refuses when it would leave no other active owner', async () => {
    // The only other owner is SUSPENDED, so replacing the active one would lock everyone out.
    await makeOwner('solo', 21);
    await makeOwner('sleeping', 22, 'SUSPENDED');
    // Owners made by the earlier tests share this database: put them to sleep too.
    await ds.query(
      `UPDATE users SET status = 'SUSPENDED'
       WHERE id IN (SELECT user_id FROM platform_admins) AND email <> $1`,
      [mail('solo')],
    );
    await expect(
      replaceOwner(ds, { oldEmail: mail('solo'), newEmail: mail('n3'), newPhone: phone(23) }),
    ).rejects.toThrow(/no other active platform owner/);
    expect(await ds.query(`SELECT 1 FROM users WHERE email = $1`, [mail('n3')])).toHaveLength(0);
  });

  it('waits for the advisory lock before counting other owners', async () => {
    await makeOwner('lk-a', 31);
    await makeOwner('lk-b', 32);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const gotLock = new Promise<void>((r) => (locked = r));
    // Another transaction holds the lock until we release it (latch, no sleeps).
    const holder = ds.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock($1)', [REPLACE_OWNER_LOCK_KEY]);
      locked();
      await held;
    });
    await gotLock;
    let done = false;
    const run = replaceOwner(ds, {
      oldEmail: mail('lk-a'),
      newEmail: mail('lk-n'),
      newPhone: phone(33),
    }).then(() => (done = true));
    // The replace is blocked on pg_advisory_xact_lock while the holder keeps it.
    await expect
      .poll(async () => {
        const rows = await ds.query(
          `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = $1`,
          [REPLACE_OWNER_LOCK_KEY],
        );
        return rows.length;
      })
      .toBeGreaterThan(0);
    expect(done).toBe(false);
    release();
    await holder;
    await run;
    expect(done).toBe(true);
  });

  it('keeps its inline MFA deletes in step with MfaService.reset', () => {
    const tables = (file: string, re: RegExp) =>
      [...fs.readFileSync(path.join(__dirname, file), 'utf8').matchAll(re)].map((m) => m[1]);
    const mfa = tables('../modules/auth/mfa/mfa.service.ts', /DELETE FROM (\w+) WHERE user_id/g);
    // The script deletes via entities; map entity -> table by name.
    const script = fs.readFileSync(path.join(__dirname, 'cockpit-replace-owner.ts'), 'utf8');
    const entityToTable: Record<string, string> = {
      UserMfa: 'user_mfa',
      UserRecoveryCode: 'user_recovery_codes',
    };
    for (const table of new Set(mfa)) {
      const entity = Object.keys(entityToTable).find((k) => entityToTable[k] === table);
      // If MfaService.reset starts touching a new table, the script must too.
      expect(entity, `MfaService deletes from ${table}`).toBeDefined();
      expect(script).toContain(`em.delete(${entity},`);
    }
  });

  it('validates input shape', () => {
    expect(
      validateReplaceInput({ oldEmail: 'x', newEmail: 'a@b.co', newPhone: '+8801711111111' }),
    ).toMatch(/old-email/);
    expect(
      validateReplaceInput({ oldEmail: 'a@b.co', newEmail: 'A@b.co', newPhone: '+8801711111111' }),
    ).toMatch(/must differ/);
    expect(
      validateReplaceInput({ oldEmail: 'a@b.co', newEmail: 'c@b.co', newPhone: '017' }),
    ).toMatch(/E.164/);
    expect(
      validateReplaceInput({ oldEmail: 'a@b.co', newEmail: 'c@b.co', newPhone: '+8801711111111' }),
    ).toBeNull();
  });
});
