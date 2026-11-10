import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuditAction, UserStatus } from '@biddaloy/shared';
import { CockpitPasswordService, COCKPIT_RESET_REFUSED } from './cockpit-password.service';

vi.mock('../password-hash', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../password-hash')>()),
  hashPassword: vi.fn(async (p: string) => `hash:${p}`),
}));

// forgot() does not wait for its detached job; let it finish before asserting.
const flush = () => new Promise((resolve) => setImmediate(resolve));

const ctx = { ip: '1.1.1.1', userAgent: 'ua' };
const GOOD_PASSWORD = 'Correct-Horse-Battery-9!';
const owner = (over: object = {}) => ({
  id: 'u1',
  full_name: 'Owner',
  email: 'One@x.com',
  phone: '01711111111',
  status: UserStatus.ACTIVE,
  deleted_at: null,
  ...over,
});

describe('CockpitPasswordService', () => {
  let user: any;
  let isAdmin: boolean;
  let findOne: ReturnType<typeof vi.fn>;
  let issue: ReturnType<typeof vi.fn>;
  let verify: ReturnType<typeof vi.fn>;
  let delivery: any;
  let svc: CockpitPasswordService;
  let users: any;
  let refreshTokens: any;
  let cutoff: any;
  let attempts: any;
  let audit: any;
  let authTokens: any;

  beforeEach(() => {
    user = owner();
    isAdmin = true;
    findOne = vi.fn(async () => user);
    users = { findOne, update: vi.fn() };
    issue = vi.fn().mockResolvedValue({ raw: 'RAWTOKEN' });
    verify = vi.fn().mockResolvedValue({
      status: 'valid',
      row: { id: 'row1', user_id: 'u1', tenant_id: null, metadata: { email: 'one@x.com' } },
    });
    authTokens = { issue, verify, consume: vi.fn() };
    delivery = {
      deliver: vi.fn(),
      detach: vi.fn(async (_f: string, work: () => Promise<unknown>) => work()),
    };
    refreshTokens = { revokeAllForUser: vi.fn() };
    cutoff = { cutOff: vi.fn() };
    attempts = { reset: vi.fn() };
    audit = { record: vi.fn() };
    svc = new CockpitPasswordService(
      users,
      { exists: vi.fn(async () => isAdmin) } as any,
      authTokens,
      delivery,
      refreshTokens,
      cutoff,
      attempts,
      audit,
      { get: (k: string) => (k === 'COCKPIT_DOMAIN' ? 'cockpit.example.com' : undefined) } as any,
    );
  });

  describe('forgot', () => {
    it('emails an owner a link on the cockpit host, tenant-less, bound to the address', async () => {
      await svc.forgot('one@x.com');
      await flush();
      expect(issue).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', tenantId: null, metadata: { email: 'one@x.com' } }),
      );
      const sent = delivery.deliver.mock.calls[0][0];
      expect(sent).toMatchObject({ tenantId: null, medium: 'EMAIL', to: 'One@x.com' });
      expect(sent.vars.link).toBe('https://cockpit.example.com/sign-in/reset?token=RAWTOKEN');
    });

    it('answers the same, with one lookup, for unknown, school, locked and owner identifiers', async () => {
      const outcomes: unknown[] = [];
      const cases: Array<[() => void, boolean]> = [
        [() => (user = null), false], // unknown
        [() => ((user = owner()), (isAdmin = false)), false], // a school user
        [() => ((isAdmin = true), (user = owner({ status: UserStatus.SUSPENDED }))), false], // locked owner
        [() => (user = owner()), true], // real owner
      ];
      for (const [setup, sends] of cases) {
        setup();
        findOne.mockClear();
        delivery.deliver.mockClear();
        outcomes.push(await svc.forgot('x@x.com'));
        await flush();
        expect(findOne).toHaveBeenCalledTimes(1); // the request path is one lookup
        expect(delivery.deliver).toHaveBeenCalledTimes(sends ? 1 : 0);
      }
      expect(new Set(outcomes).size).toBe(1);
    });

    it('a failing send never reaches the caller', async () => {
      delivery.deliver.mockRejectedValue(new Error('boom'));
      delivery.detach.mockImplementation(async (_f: string, work: () => Promise<unknown>) =>
        work().catch(() => undefined),
      );
      await expect(svc.forgot('one@x.com')).resolves.toBeUndefined();
    });
  });

  describe('reset', () => {
    const reset = (over: object = {}) =>
      svc.reset({ token: 'RAWTOKEN', newPassword: GOOD_PASSWORD, ...over }, ctx);

    it('sets the password, ends every session, bumps the cut-off, audits and returns no session', async () => {
      expect(await reset()).toBeUndefined();
      expect(users.update).toHaveBeenCalledWith('u1', { password_hash: `hash:${GOOD_PASSWORD}` });
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('u1');
      expect(cutoff.cutOff).toHaveBeenCalledWith('u1'); // Rule 8
      expect(authTokens.consume).toHaveBeenCalledWith('row1');
      expect(attempts.reset).toHaveBeenCalledWith('cockpit:user:u1');
      expect(attempts.reset).toHaveBeenCalledWith('cockpit:one@x.com');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.PLATFORM_PASSWORD_RESET, tenant_id: null }),
      );
    });

    async function refused(over?: object) {
      const err: any = await reset(over).catch((e) => e);
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toBe(COCKPIT_RESET_REFUSED);
      expect(users.update).not.toHaveBeenCalled();
      expect(authTokens.consume).not.toHaveBeenCalled();
    }

    it('refuses a reused, expired or unknown token', async () => {
      for (const status of ['consumed', 'expired', 'unknown', 'revoked']) {
        verify.mockResolvedValueOnce({ status });
        await refused();
      }
    });

    it("refuses a school user's token (not an owner, or a tenant token)", async () => {
      isAdmin = false;
      await refused();
      isAdmin = true;
      verify.mockResolvedValueOnce({
        status: 'valid',
        row: { id: 'row1', user_id: 'u1', tenant_id: 'tenant-1', metadata: { email: 'one@x.com' } },
      });
      await refused();
    });

    it('refuses a link whose address no longer matches, a locked owner and a deleted user', async () => {
      user = owner({ email: 'new@x.com' });
      await refused();
      user = owner({ status: UserStatus.SUSPENDED });
      await refused();
      user = null;
      await refused();
    });

    it('a weak password is a 400 and does not burn the link', async () => {
      await expect(reset({ newPassword: 'short' })).rejects.toMatchObject({ status: 400 });
      expect(authTokens.consume).not.toHaveBeenCalled();
    });
  });
});
