import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as os from 'os';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { resetOwnerMfa, printResetResult } from './cockpit-reset-mfa';

describe('cockpit-reset-mfa (integration)', () => {
  let ds: DataSource;
  const tag = `${process.pid}-${Date.now()}`;
  const mail = (n: string) => `reset-mfa-${n}-${tag}@example.com`;
  const base = 1_000_000_000 + (process.pid % 1000) * 100_000 + 50_000;
  const created: string[] = [];

  async function makeUser(name: string, n: number, owner: boolean): Promise<string> {
    const [row] = await ds.query(
      `INSERT INTO users (email, phone, full_name, status) VALUES ($1, $2, 'U', 'ACTIVE') RETURNING id`,
      [mail(name), `+8801${base + n}`],
    );
    if (owner) await ds.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [row.id]);
    created.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM platform_admins WHERE user_id = ANY($1)`, [created]);
    await ds.query(`DELETE FROM users WHERE id = ANY($1)`, [created]);
  });

  it('resets the owner, cuts sessions, writes one audit row with no tenant', async () => {
    const id = await makeUser('own', 1, true);
    const out = await resetOwnerMfa(ds, mail('own').toUpperCase());
    expect(out).toBe(id);
    const [u] = await ds.query(`SELECT tokens_valid_after FROM users WHERE id = $1`, [id]);
    // Rule 8: old access tokens die.
    expect(u.tokens_valid_after).not.toBeNull();
    const audit = await ds.query(
      `SELECT * FROM audit_logs WHERE action = 'PLATFORM_MFA_RESET' AND entity_id = $1`,
      [id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].tenant_id).toBeNull();
    expect(audit[0].new_values.operator).toBe(os.userInfo().username);
    // No personal data in the audit row.
    expect(JSON.stringify(audit[0])).not.toContain('@example.com');
  });

  it('deletes only the target owner second-factor rows and revokes their refresh token', async () => {
    const target = await makeUser('t', 3, true);
    const other = await makeUser('o', 4, true);
    const hash = (c: string) => c.repeat(64);
    for (const [uid, c] of [
      [target, 'a'],
      [other, 'b'],
    ]) {
      await ds.query(`INSERT INTO user_mfa (user_id, secret_enc) VALUES ($1, 'x')`, [uid]);
      await ds.query(`INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, $2)`, [
        uid,
        hash(c),
      ]);
      await ds.query(`INSERT INTO platform_admin_devices (user_id, device_hash) VALUES ($1, $2)`, [
        uid,
        hash(c),
      ]);
      await ds.query(
        `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
         VALUES ($1, gen_random_uuid(), $2, now() + interval '1 day')`,
        [uid, hash(c)],
      );
    }
    await resetOwnerMfa(ds, mail('t'));
    const count = async (table: string, uid: string) =>
      (await ds.query(`SELECT 1 FROM ${table} WHERE user_id = $1`, [uid])).length;
    for (const table of ['user_mfa', 'user_recovery_codes', 'platform_admin_devices']) {
      expect(await count(table, target)).toBe(0);
      // Another owner's rows are untouched.
      expect(await count(table, other)).toBe(1);
    }
    const [t] = await ds.query(`SELECT revoked_at FROM refresh_tokens WHERE user_id = $1`, [
      target,
    ]);
    const [o] = await ds.query(`SELECT revoked_at FROM refresh_tokens WHERE user_id = $1`, [other]);
    expect(t.revoked_at).not.toBeNull();
    expect(o.revoked_at).toBeNull();
    const [tu] = await ds.query(`SELECT tokens_valid_after FROM users WHERE id = $1`, [target]);
    const [ou] = await ds.query(`SELECT tokens_valid_after FROM users WHERE id = $1`, [other]);
    expect(tu.tokens_valid_after).not.toBeNull();
    expect(ou.tokens_valid_after).toBeNull();
    await ds.query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1)`, [[target, other]]);
  });

  it('prints no email or phone', () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a) => void lines.push(a.join(' ')));
    printResetResult('11111111-1111-1111-1111-111111111111');
    spy.mockRestore();
    const text = lines.join('\n');
    expect(text).toContain('11111111-1111-1111-1111-111111111111');
    expect(text).not.toMatch(/@|\+\d{8,}/);
  });

  it('refuses a normal user and an unknown email with the same message, echoing nothing', async () => {
    await makeUser('norm', 2, false);
    const a = await resetOwnerMfa(ds, mail('norm')).catch((e: Error) => e.message);
    const b = await resetOwnerMfa(ds, mail('ghost')).catch((e: Error) => e.message);
    expect(a).toBe(b);
    expect(a).not.toContain('example.com');
  });

  it('rejects a malformed email', async () => {
    await expect(resetOwnerMfa(ds, 'nope')).rejects.toThrow(/--email/);
  });
});
