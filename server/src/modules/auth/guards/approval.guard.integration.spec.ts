import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Redis from 'ioredis';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ApprovalScope } from '@biddaloy/shared';
import { ApprovalService } from './approval.guard';
import { ApprovalRequiredException } from '../../../common/errors/approval-required.exception';

const SECRET = 'test-approval-secret';
const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'actor-1';
const APPROVER_ID = 'approver-1';

/**
 * Integration tests for ApprovalService.consume against a real Redis
 * instance — the single-use guarantee (GETDEL) only means something
 * against real concurrency, which mocked Redis in approval.guard.spec.ts
 * can't exercise honestly.
 */
describe('ApprovalService.consume (integration)', () => {
  let redis: Redis;
  let jwtService: JwtService;
  let configService: ConfigService;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    jwtService = new JwtService({ secret: SECRET });
    configService = { get: () => SECRET } as unknown as ConfigService;
  });

  afterAll(async () => {
    redis.disconnect();
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  function service(): ApprovalService {
    return new ApprovalService(jwtService, configService, redis);
  }

  async function issueToken(
    jti: string,
    overrides: Partial<{
      scope: ApprovalScope;
      tid: string;
      act: string;
      sub: string;
      typ: string;
    }> = {},
  ): Promise<string> {
    await redis.set(`approval:${jti}`, '1', 'EX', 300);
    return jwtService.signAsync(
      {
        typ: 'approval',
        sub: APPROVER_ID,
        act: ACTOR_ID,
        tid: TENANT_ID,
        scope: ApprovalScope.PAYMENTS_REVERSE,
        jti,
        ...overrides,
      },
      { expiresIn: 300 },
    );
  }

  function req(token: string) {
    return {
      headers: { 'x-approval-token': token },
      currentTenant: { id: TENANT_ID },
      user: { sub: ACTOR_ID },
    };
  }

  it('a valid, unused token is consumed and its Redis key is deleted', async () => {
    const token = await issueToken('jti-happy');

    const result = await service().consume(req(token), ApprovalScope.PAYMENTS_REVERSE);

    expect(result).toEqual({
      approverId: APPROVER_ID,
      scope: ApprovalScope.PAYMENTS_REVERSE,
      jti: 'jti-happy',
    });
    expect(await redis.get('approval:jti-happy')).toBeNull();
  });

  it('reusing the same token a second time is rejected with APPROVAL_REQUIRED', async () => {
    const token = await issueToken('jti-reuse');
    const svc = service();

    await svc.consume(req(token), ApprovalScope.PAYMENTS_REVERSE);

    await expect(svc.consume(req(token), ApprovalScope.PAYMENTS_REVERSE)).rejects.toThrow(
      ApprovalRequiredException,
    );
  });

  it('a token whose Redis key was never staged (expired/never issued) is rejected', async () => {
    // Sign a token without calling issueToken's redis.set, so the jti has
    // no backing key at all — same observable outcome as one that expired.
    const token = await jwtService.signAsync(
      {
        typ: 'approval',
        sub: APPROVER_ID,
        act: ACTOR_ID,
        tid: TENANT_ID,
        scope: ApprovalScope.PAYMENTS_REVERSE,
        jti: 'jti-never-staged',
      },
      { expiresIn: 300 },
    );

    await expect(service().consume(req(token), ApprovalScope.PAYMENTS_REVERSE)).rejects.toThrow(
      ApprovalRequiredException,
    );
  });

  it('two parallel requests with the same token → exactly one succeeds', async () => {
    const token = await issueToken('jti-parallel');
    const svc = service();

    const results = await Promise.allSettled([
      svc.consume(req(token), ApprovalScope.PAYMENTS_REVERSE),
      svc.consume(req(token), ApprovalScope.PAYMENTS_REVERSE),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ApprovalRequiredException);

    // The key is gone either way — the loser didn't leave it dangling.
    expect(await redis.get('approval:jti-parallel')).toBeNull();
  });
});
