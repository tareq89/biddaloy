import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { StaffProfilesService } from './staff-profiles.service';
import { StaffProfile } from './entities/staff-profile.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { School } from '../schools/entities/school.entity';
import { Teacher } from '../academics/entities/teacher.entity';

const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';
const short = (t: string) => t.slice(0, 8);

describe('StaffProfilesService (integration)', () => {
  let service: StaffProfilesService;
  let ds: DataSource;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [StaffProfilesService], [], {
      synchronize: true,
      dropSchema: true,
    });
    service = module.get(StaffProfilesService);
    ds = module.get(DataSource);
    const schools = ds.getRepository(School);
    for (const [id, slug] of [
      [SEED_TENANT_ID, 'sp-a'],
      [OTHER_TENANT, 'sp-b'],
    ]) {
      await schools.save(schools.create({ id, name: slug, slug, tenant_id: id }));
    }
  }, 60000);

  afterAll(async () => ds?.destroy());

  beforeEach(async () => {
    await ds.query('DELETE FROM teachers');
    await ds.query('DELETE FROM staff_profiles');
    await ds.query('DELETE FROM users');
  });

  async function user(n: string): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO users (email, full_name, status, created_at, updated_at)
       VALUES ($1, $1, 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`${n}@example.com`],
    );
    return id;
  }

  it('[TEN-10] removing a middle profile does not block the next create', async () => {
    const p = `EMP-${short(SEED_TENANT_ID)}-`;
    for (const n of [1, 2, 3]) {
      await ds.query(
        `INSERT INTO staff_profiles (user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [await user(`seed${n}`), SEED_TENANT_ID, `${p}${n}`],
      );
    }
    await ds.query(`DELETE FROM staff_profiles WHERE employee_id = $1`, [`${p}2`]);

    const created = await service.createFor(await user('new'), SEED_TENANT_ID);
    expect(created.employee_id).toBe(`${p}4`);
  });

  it("another tenant's ids do not affect this tenant's series", async () => {
    await ds.query(
      `INSERT INTO staff_profiles (user_id, tenant_id, employee_id, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [await user('other'), OTHER_TENANT, `EMP-${short(OTHER_TENANT)}-50`],
    );
    const created = await service.createFor(await user('mine'), SEED_TENANT_ID);
    expect(created.employee_id).toBe(`EMP-${short(SEED_TENANT_ID)}-1`);
    expect(await ds.getRepository(StaffProfile).count()).toBe(2);
  });

  // #2291: TeacherStaffProfileSubscriber (workbook restore, fixtures) used
  // `count + 1`. With EMP-1 and EMP-3 left, count = 2 → EMP-3 again → unique
  // violation that aborts the caller's transaction.
  it('[TEN-10] a Teacher insert after a middle profile was removed gets the next id', async () => {
    const p = `EMP-${short(SEED_TENANT_ID)}-`;
    for (const n of [1, 2, 3]) {
      await ds.query(
        `INSERT INTO staff_profiles (user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [await user(`t-seed${n}`), SEED_TENANT_ID, `${p}${n}`],
      );
    }
    await ds.query(`DELETE FROM staff_profiles WHERE employee_id = $1`, [`${p}2`]);

    const teachers = ds.getRepository(Teacher);
    const userId = await user('t-new');
    const teacher = await teachers.save(
      teachers.create({ user_id: userId, tenant_id: SEED_TENANT_ID, employee_id: 'T-NEW' }),
    );
    const profile = await ds
      .getRepository(StaffProfile)
      .findOneByOrFail({ id: teacher.staff_profile_id });
    expect(profile.employee_id).toBe(`${p}4`);
  });
});
