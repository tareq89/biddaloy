import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { replaceOwner, validateReplaceInput } from './cockpit-replace-owner';

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
