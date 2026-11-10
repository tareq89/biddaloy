import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { RefreshTokenService, REFRESH_TOKEN_TTL_MS } from '../refresh-token.service';
import { RefreshToken } from '../entities/refresh-token.entity';
import { SessionCutoffService } from '../session-cutoff.service';
import { User } from '../../users/entities/user.entity';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import { CockpitSessionService } from './cockpit-session.service';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ctx = { ip: null, userAgent: null };

describe('CockpitSessionService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let redis: Redis;
  let refreshTokens: RefreshTokenService;
  let cutoff: SessionCutoffService;
  const jwt = new JwtService({
    secret: 'integration-secret-integration-1234',
    signOptions: { issuer: 'biddaloy' },
  });

  beforeAll(async () => {
    module = await createTestModule(
      [...ALL_ENTITIES, RefreshToken],
      [
        RefreshTokenService,
        SessionCutoffService,
        { provide: REFRESH_TOKEN_TTL_MS, useValue: 60_000 },
      ],
    );
    ds = module.get(DataSource);
    refreshTokens = module.get(RefreshTokenService);
    cutoff = module.get(SessionCutoffService);
    redis = new Redis(process.env.REDIS_URL!);
  });

  afterAll(async () => {
    redis.disconnect();
    await module.close();
  });

  function make(limits: { idleMs: number; absoluteMs: number }, r: Redis = redis) {
    return new CockpitSessionService(
      jwt,
      refreshTokens,
      cutoff,
      r,
      ds.getRepository(User),
      ds.getRepository(PlatformAdmin),
      limits,
    );
  }

  async function owner(): Promise<User> {
    const users = ds.getRepository(User);
    const u = await users.save(users.create({ full_name: 'Owner', status: UserStatus.ACTIVE }));
    await ds.getRepository(PlatformAdmin).insert({ user_id: u.id });
    return u;
  }

  it('idle expiry: refresh works while active, then is refused after the idle time', async () => {
    const u = await owner();
    const svc = make({ idleMs: 600, absoluteMs: 60_000 });
    const s = await svc.start(u.id, ctx);
    const next = await svc.refresh(s.refreshCookieValue, ctx);
    expect(next.familyId).toBe(s.familyId);
    await wait(900); // idle key (600 ms) has expired; waiting on a TTL is the thing under test
    await expect(svc.refresh(next.refreshCookieValue, ctx)).rejects.toThrow();
  });

  it('absolute expiry: refresh is refused after the absolute time even when kept active', async () => {
    const u = await owner();
    const svc = make({ idleMs: 60_000, absoluteMs: 700 });
    const s = await svc.start(u.id, ctx);
    await wait(900);
    await expect(svc.refresh(s.refreshCookieValue, ctx)).rejects.toThrow();
  });

  it('reusing a rotated cookie after the grace window still kills the family', async () => {
    const u = await owner();
    const svc = make({ idleMs: 60_000, absoluteMs: 60_000 });
    const s = await svc.start(u.id, ctx);
    await svc.refresh(s.refreshCookieValue, ctx);
    // Age the rotated row past the grace window so the replay counts as reuse.
    await ds.query(
      `UPDATE refresh_tokens SET revoked_at = now() - interval '1 minute' WHERE family_id = $1 AND revoked_at IS NOT NULL`,
      [s.familyId],
    );
    await expect(svc.refresh(s.refreshCookieValue, ctx)).rejects.toThrow();
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM refresh_tokens WHERE family_id = $1 AND revoked_at IS NULL`,
      [s.familyId],
    );
    expect(n).toBe(0);
  });

  it('endAll ends every family and bumps tokens_valid_after', async () => {
    const u = await owner();
    const svc = make({ idleMs: 60_000, absoluteMs: 60_000 });
    const a = await svc.start(u.id, ctx);
    const b = await svc.start(u.id, ctx);
    await svc.endAll(u.id);
    for (const s of [a, b]) {
      await expect(svc.refresh(s.refreshCookieValue, ctx)).rejects.toThrow();
      expect(await redis.exists(`cockpit:abs:${s.familyId}`)).toBe(0);
    }
    const [row] = await ds.query('SELECT tokens_valid_after FROM users WHERE id = $1', [u.id]);
    expect(row.tokens_valid_after).not.toBeNull();
  });

  it('Redis down refuses to start a session', async () => {
    const u = await owner();
    const dead = new Redis(process.env.REDIS_URL!, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    dead.disconnect();
    const svc = make({ idleMs: 60_000, absoluteMs: 60_000 }, dead);
    await expect(svc.start(u.id, ctx)).rejects.toThrow();
    const [{ n }] = await ds.query(
      'SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1',
      [u.id],
    );
    expect(n).toBe(0);
    void randomUUID;
  });
});
