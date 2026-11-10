import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { resetOwnerMfa } from './cockpit-reset-mfa';

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
