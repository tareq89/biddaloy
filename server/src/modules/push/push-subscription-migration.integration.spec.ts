import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { PushSubscription } from './entities/push-subscription.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';

/**
 * [#552] Verifies the `AddPushSubscriptions` migration actually landed:
 * the `push_subscriptions` table exists with the right columns/nullability,
 * `endpoint` is unique, and a row can be saved and read back through the
 * ORM. Runs against the already-migrated test database (no `synchronize` /
 * `dropSchema`) — see `server/CLAUDE.md`'s note on why new specs should
 * prefer that.
 */
describe('AddPushSubscriptions migration (integration)', () => {
  let dataSource: DataSource;
  let schoolRepo: Repository<School>;
  let userRepo: Repository<User>;
  let pushSubscriptionRepo: Repository<PushSubscription>;

  beforeAll(async () => {
    const module = await createTestModule([...ALL_ENTITIES, PushSubscription], []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    pushSubscriptionRepo = module.get<Repository<PushSubscription>>(
      getRepositoryToken(PushSubscription),
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('creates the push_subscriptions table with the expected columns', async () => {
    const rows = await dataSource.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'push_subscriptions'
       ORDER BY column_name`,
    );
    expect(rows).toEqual([
      { column_name: 'auth', is_nullable: 'NO' },
      { column_name: 'created_at', is_nullable: 'NO' },
      { column_name: 'endpoint', is_nullable: 'NO' },
      { column_name: 'failure_count', is_nullable: 'NO' },
      { column_name: 'id', is_nullable: 'NO' },
      { column_name: 'last_used_at', is_nullable: 'YES' },
      { column_name: 'p256dh', is_nullable: 'NO' },
      { column_name: 'tenant_id', is_nullable: 'NO' },
      { column_name: 'user_agent', is_nullable: 'YES' },
      { column_name: 'user_id', is_nullable: 'NO' },
    ]);
  });

  it('indexes user_id', async () => {
    const rows = await dataSource.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'push_subscriptions' AND indexname = 'IDX_push_subscriptions_user'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('saves and reads back a subscription scoped to a user and tenant, and rejects a duplicate endpoint', async () => {
    const school = await schoolRepo.save(
      schoolRepo.create({
        name: `Test School ${randomUUID()}`,
        slug: `test-school-${randomUUID()}`,
      }),
    );
    const user = await userRepo.save(
      userRepo.create({
        email: `push-test-${randomUUID()}@example.com`,
        password_hash: 'not-a-real-hash',
        full_name: 'Push Test User',
      }),
    );
    const endpoint = `https://push.example.com/${randomUUID()}`;

    const saved = await pushSubscriptionRepo.save(
      pushSubscriptionRepo.create({
        user_id: user.id,
        tenant_id: school.id,
        endpoint,
        p256dh: 'p256dh-key',
        auth: 'auth-secret',
        user_agent: null,
      }),
    );

    expect(saved.failure_count).toBe(0);
    expect(saved.last_used_at).toBeNull();

    const reloaded = await pushSubscriptionRepo.findOneOrFail({ where: { id: saved.id } });
    expect(reloaded.endpoint).toBe(endpoint);
    expect(reloaded.tenant_id).toBe(school.id);
    expect(reloaded.user_id).toBe(user.id);

    await expect(
      pushSubscriptionRepo.save(
        pushSubscriptionRepo.create({
          user_id: user.id,
          tenant_id: school.id,
          endpoint,
          p256dh: 'other-key',
          auth: 'other-secret',
        }),
      ),
    ).rejects.toThrow();
  });

  describe('PushSubscriptionEndpointPerTenant', () => {
    async function seed() {
      const mkSchool = () =>
        schoolRepo.save(
          schoolRepo.create({ name: `S ${randomUUID()}`, slug: `s-${randomUUID()}` }),
        );
      const [a, b] = [await mkSchool(), await mkSchool()];
      const user = await userRepo.save(
        userRepo.create({
          email: `push-pt-${randomUUID()}@example.com`,
          password_hash: 'x',
          full_name: 'Push PT',
        }),
      );
      const row = (tenantId: string, endpoint: string) =>
        pushSubscriptionRepo.save(
          pushSubscriptionRepo.create({
            user_id: user.id,
            tenant_id: tenantId,
            endpoint,
            p256dh: 'p',
            auth: 'a',
          }),
        );
      return { a, b, row };
    }

    it('allows the same endpoint once per tenant and rejects a second row in one tenant with 23505', async () => {
      const { a, b, row } = await seed();
      const endpoint = `https://push.example.com/${randomUUID()}`;

      await row(a.id, endpoint);
      await row(b.id, endpoint);

      await expect(row(a.id, endpoint)).rejects.toMatchObject({ code: '23505' });
    });

    it('down refuses while an endpoint exists in two tenants, then round-trips once cleaned', async () => {
      const { a, b, row } = await seed();
      const endpoint = `https://push.example.com/${randomUUID()}`;
      const first = await row(a.id, endpoint);
      await row(b.id, endpoint);

      const { PushSubscriptionEndpointPerTenant1791805000100: Migration } =
        await import('../../migrations/1791805000100-PushSubscriptionEndpointPerTenant');
      const qr = dataSource.createQueryRunner();
      try {
        await expect(new Migration().down(qr)).rejects.toThrow(/more than one tenant/);

        // Clean ALL cross-tenant duplicates (other tests in this file may have left some), revert, re-apply.
        await dataSource.query(
          `DELETE FROM push_subscriptions p USING push_subscriptions q
           WHERE p.endpoint = q.endpoint AND p.id > q.id`,
        );
        await new Migration().down(qr);
        await new Migration().up(qr);
      } finally {
        await qr.release();
      }
      expect(first.id).toBeDefined();

      // After down() + up() the per-tenant key is back: once per tenant, not twice in one.
      const again = `https://push.example.com/${randomUUID()}`;
      await row(a.id, again);
      await row(b.id, again);
      await expect(row(a.id, again)).rejects.toMatchObject({ code: '23505' });
    });
  });
});
