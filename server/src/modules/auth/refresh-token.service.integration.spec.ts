import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { RefreshTokenService, REFRESH_TOKEN_TTL_MS } from './refresh-token.service';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';

/**
 * Review m-new-2: a refresh rotation and a "revoke every session" must not interleave so that the
 * rotation's successor outlives the revoke. Rotation holds the user row FOR SHARE while it claims
 * the old token and inserts the successor; revokeAllForUser takes it FOR UPDATE first.
 */
describe('RefreshTokenService (integration): rotation vs revoke-all', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: RefreshTokenService;
  const context = { ip: '127.0.0.1', userAgent: 'vitest' };

  beforeAll(async () => {
    // ALL_ENTITIES leaves RefreshToken out.
    module = await createTestModule(
      [...ALL_ENTITIES, RefreshToken],
      [RefreshTokenService, { provide: REFRESH_TOKEN_TTL_MS, useValue: 3_600_000 }],
    );
    dataSource = module.get(DataSource);
    service = module.get(RefreshTokenService);
  });

  afterAll(async () => {
    await module?.close();
  });

  const liveTokens = async (userId: string) =>
    Number(
      (
        await dataSource.query(
          'SELECT count(*) n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
          [userId],
        )
      )[0].n,
    );

  it('revoke-all waits for a rotation in flight and revokes its successor too', async () => {
    const repo = dataSource.getRepository(User);
    const user = await repo.save(repo.create({ full_name: 'Rotating', status: UserStatus.ACTIVE }));
    await service.issueForUser(user.id, randomUUID(), context);

    // A rotation that has claimed its share lock and is about to insert the successor.
    const rotation = dataSource.createQueryRunner();
    await rotation.connect();
    await rotation.startTransaction();
    await rotation.query('SELECT 1 FROM users WHERE id = $1 FOR SHARE', [user.id]);
    await rotation.query(
      `INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, 'successor', NOW() + interval '1 hour')`,
      [randomUUID(), user.id, randomUUID()],
    );

    const revoke = service.revokeAllForUser(user.id);
    await new Promise((r) => setTimeout(r, 300));
    await rotation.commitTransaction();
    await rotation.release();
    await revoke;

    expect(await liveTokens(user.id)).toBe(0);
  });

  it('rotate still works on its own and leaves exactly one live token', async () => {
    const repo = dataSource.getRepository(User);
    const user = await repo.save(repo.create({ full_name: 'Plain', status: UserStatus.ACTIVE }));
    const first = await service.issueForUser(user.id, randomUUID(), context);

    const rotated = await service.rotate(first.cookieValue, context);

    expect(rotated.userId).toBe(user.id);
    expect(await liveTokens(user.id)).toBe(1);
  });
});
