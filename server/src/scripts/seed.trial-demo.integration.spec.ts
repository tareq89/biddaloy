import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { EnrollmentStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../modules/schools/entities/school.entity';
import { Student } from '../modules/students/entities/student.entity';
import { User } from '../modules/users/entities/user.entity';
import { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import { AuthToken } from '../modules/account-access/entities/auth-token.entity';
import { hashSecret } from '../modules/auth/token-hash.util';
import { SEED_TRIAL_SCHOOL } from '../../../e2e/seed-contract';
import { ensureTrialDemoSeed, TRIAL_DEMO } from './seed.accounts';

describe('ensureTrialDemoSeed (integration)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('matches the e2e seed contract', () => {
    expect(TRIAL_DEMO).toEqual(SEED_TRIAL_SCHOOL);
  });

  it('is idempotent: a trial school at 4 of 10 seats, an admin, and an invited teacher', async () => {
    const first = await ensureTrialDemoSeed(ds.manager, 'x');
    const second = await ensureTrialDemoSeed(ds.manager, 'x');

    expect(second.id).toBe(first.id);
    expect(await ds.getRepository(School).countBy({ slug: TRIAL_DEMO.slug })).toBe(1);
    expect(first.seat_limit).toBe(10);
    expect(first.onboarding).toBeNull();
    const daysLeft = Math.round((first.trial_ends_at!.getTime() - Date.now()) / 86_400_000);
    expect(daysLeft).toBe(23);

    // Business-critical: the "4 of 10" the trial banner shows.
    expect(
      await ds
        .getRepository(Student)
        .countBy({ tenant_id: first.id, enrollment_status: EnrollmentStatus.ACTIVE }),
    ).toBe(4);
    expect(await ds.getRepository(UserTenant).countBy({ tenant_id: first.id })).toBe(2);

    const teacher = await ds
      .getRepository(User)
      .findOneByOrFail({ email: TRIAL_DEMO.teacherEmail });
    expect(teacher.password_hash).toBeNull();
    expect(
      await ds
        .getRepository(AuthToken)
        .countBy({ user_id: teacher.id, token_hash: hashSecret(TRIAL_DEMO.inviteToken) }),
    ).toBe(1);
  });
});
