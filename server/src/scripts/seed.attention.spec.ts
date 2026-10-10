import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@biddaloy/shared';
import { ASSISTANT_TEACHER_EMAIL, ROLE_TEST_USERS } from './seed.util';
import { ensureAttentionSeed, type AttentionSeedRepositories } from './seed.attention';

/** Minimal in-memory repo: findOne by equality, create, save. */
class FakeRepo {
  readonly rows: Record<string, unknown>[] = [];
  private n = 0;
  constructor(private readonly prefix: string) {}
  findOne({ where }: { where: Record<string, unknown> }) {
    const hit = this.rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v));
    return Promise.resolve(hit ?? null);
  }
  create(data: Record<string, unknown>) {
    return { ...data };
  }
  save(e: Record<string, unknown>) {
    if (e.id === undefined) e.id = `${this.prefix}-${(this.n += 1)}`;
    if (!this.rows.includes(e)) this.rows.push(e);
    return Promise.resolve(e);
  }
}

const TENANT = 'school-1';
const ROLES = ROLE_TEST_USERS.filter(
  (u) => u.role !== UserRole.SUPER_ADMIN && u.email !== ASSISTANT_TEACHER_EMAIL,
).length;

function setup(missingEmail?: string) {
  const r = {
    user: new FakeRepo('user'),
    userTenant: new FakeRepo('ut'),
    alert: new FakeRepo('alert'),
    recipient: new FakeRepo('rcpt'),
  };
  for (const { email, role } of ROLE_TEST_USERS) {
    const user = { email, id: `u-${email}` };
    void r.user.save(user);
    if (email !== missingEmail) {
      void r.userTenant.save({ user_id: user.id, tenant_id: TENANT, role });
    }
  }
  const repos = {
    userRepository: r.user,
    userTenantRepository: r.userTenant,
    alertRepository: r.alert,
    alertRecipientRepository: r.recipient,
  } as unknown as AttentionSeedRepositories;
  return { r, repos };
}

describe('ensureAttentionSeed', () => {
  it('creates 2 alerts + recipients per role (9 roles), and a second run adds nothing', async () => {
    const { r, repos } = setup();
    expect(ROLES).toBe(9);
    await ensureAttentionSeed(repos, TENANT);
    expect(r.alert.rows).toHaveLength(18);
    expect(r.recipient.rows).toHaveLength(18);
    expect(
      r.alert.rows.every(
        (a) => a.source === 'MANUAL' && a.rule_key === 'manual.alert' && a.tenant_id === TENANT,
      ),
    ).toBe(true);
    // backdated past the 24 h send cap window, so they don't use up the daily quota
    const dayAgo = Date.now() - 24 * 3600_000;
    expect(r.alert.rows.every((a) => (a.raised_at as Date).getTime() < dayAgo)).toBe(true);
    await ensureAttentionSeed(repos, TENANT);
    expect(r.alert.rows).toHaveLength(18);
    expect(r.recipient.rows).toHaveLength(18);
  });

  it('warns once and skips a role whose user is not a member', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { r, repos } = setup('parent@biddaloy.test');
    await ensureAttentionSeed(repos, TENANT);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(r.alert.rows).toHaveLength(16);
    expect(r.recipient.rows).toHaveLength(16);
    warn.mockRestore();
  });
});
