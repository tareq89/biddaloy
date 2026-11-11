import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Repository } from 'typeorm';
import { JwtPayload, UserStatus } from '@biddaloy/shared';
import { JwtStrategy } from './jwt.strategy';
import { RequestActorContext } from '../../../common/request-actor-context';
import type { AccessTokenDenylistService } from '../access-token-denylist.service';
import type { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import type { User } from '../../users/entities/user.entity';

const SID = '11111111-1111-4111-8111-111111111111';
const PA = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const live = {
  adminId: PA,
  userId: USER,
  schoolId: 's',
  role: 'ADMIN',
  viewOnly: false,
  writeLocked: false,
  kind: 'SCHOOL_USER',
};
const active = { status: UserStatus.ACTIVE, deleted_at: null, tokens_valid_after: null };

describe('JwtStrategy imp tokens [99.2.03]', () => {
  let get: ReturnType<typeof vi.fn>;
  let findOne: ReturnType<typeof vi.fn>;
  let strategy: JwtStrategy;
  let ownerRow: Record<string, unknown>;

  const build = (redis: unknown) =>
    new JwtStrategy(
      { get: () => 'test-secret' } as unknown as ConfigService,
      new JwtService({}),
      { isRevoked: vi.fn().mockResolvedValue(false) } as unknown as AccessTokenDenylistService,
      { findOne } as unknown as Repository<User>,
      { exists: vi.fn().mockResolvedValue(false) } as unknown as Repository<PlatformAdmin>,
      redis as never,
    );
  const token = (imp: unknown = { sid: SID, pa: PA }) =>
    ({ sub: USER, memberships: [], jti: 'j', iat_ms: 2000, imp }) as unknown as JwtPayload;
  const run = (p: JwtPayload) => RequestActorContext.run(() => strategy.validate(p));

  beforeEach(() => {
    get = vi.fn().mockResolvedValue(JSON.stringify(live));
    ownerRow = { ...active };
    findOne = vi.fn(async ({ where }) => (where.id === PA ? ownerRow : active));
    strategy = build({ get });
  });

  it('valid session passes and returns impSession', async () => {
    const out = await run(token());
    expect(out).toMatchObject({ impSession: live });
    expect(get).toHaveBeenCalledWith(`imp:${SID}`);
  });

  it('key removed gives 401', async () => {
    get.mockResolvedValue(null);
    await expect(run(token())).rejects.toMatchObject({ status: 401 });
  });

  it('session of another user or another admin gives 401', async () => {
    get.mockResolvedValue(JSON.stringify({ ...live, userId: 'other' }));
    await expect(run(token())).rejects.toMatchObject({ status: 401 });
    get.mockResolvedValue(JSON.stringify({ ...live, adminId: 'other' }));
    await expect(run(token())).rejects.toMatchObject({ status: 401 });
  });

  it('owner SUSPENDED, deleted or missing gives 401', async () => {
    ownerRow.status = UserStatus.SUSPENDED;
    await expect(run(token())).rejects.toMatchObject({ status: 401 });
    ownerRow = { ...active, deleted_at: new Date() };
    await expect(run(token())).rejects.toMatchObject({ status: 401 });
    findOne.mockImplementation(async ({ where }) => (where.id === PA ? null : active));
    await expect(run(token())).rejects.toMatchObject({ status: 401 });
  });

  it('owner cut-off newer than the token gives 401', async () => {
    ownerRow.tokens_valid_after = new Date(3000);
    await expect(run(token())).rejects.toMatchObject({ status: 401 });
  });

  it('Redis error, malformed JSON, non-string and no client all give 503', async () => {
    get.mockRejectedValue(new Error('secret host:6379'));
    await expect(run(token())).rejects.toMatchObject({ status: 503 });
    get.mockResolvedValue('{not json');
    await expect(run(token())).rejects.toMatchObject({ status: 503 });
    get.mockResolvedValue(42);
    await expect(run(token())).rejects.toMatchObject({ status: 503 });
    strategy = build(undefined);
    await expect(run(token())).rejects.toMatchObject({ status: 503 });
  });

  it('malformed imp gives 401 before any Redis call', async () => {
    for (const imp of ['x', null, { sid: 'no', pa: PA }, { sid: SID }, { sid: SID, pa: 5 }]) {
      await expect(run(token(imp))).rejects.toMatchObject({ status: 401 });
    }
    expect(get).not.toHaveBeenCalled();
  });

  it('imp token without iat_ms gives 401 (no whole-second fallback)', async () => {
    const t = { ...token(), iat_ms: undefined } as unknown as JwtPayload;
    await expect(run(t)).rejects.toMatchObject({ status: 401 });
    expect(get).not.toHaveBeenCalled();
  });

  it('missing actor context gives 401', async () => {
    await expect(strategy.validate(token())).rejects.toMatchObject({ status: 401 });
  });

  it('stamps the actor context', async () => {
    await RequestActorContext.run(async () => {
      await strategy.validate(token());
      expect(RequestActorContext.impersonation()).toEqual({ sid: SID, pa: PA });
    });
  });

  it('a plain token with a stray impSession claim has it stripped', async () => {
    const t = {
      sub: USER,
      memberships: [],
      jti: 'j',
      iat_ms: 2000,
      impSession: live,
    } as unknown as JwtPayload;
    const out = await run(t);
    expect(out).not.toHaveProperty('impSession');
  });

  it('a token without imp makes no Redis call', async () => {
    const p = token();
    delete (p as { imp?: unknown }).imp;
    await strategy.validate(p);
    expect(get).not.toHaveBeenCalled();
  });
});
