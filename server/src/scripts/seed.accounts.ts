import { UserRole, UserStatus } from '@biddaloy/shared';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { User } from '../modules/users/entities/user.entity';
import { School } from '../modules/schools/entities/school.entity';
import { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import { AcademicYear } from '../modules/academics/entities/academic-year.entity';
import { Class } from '../modules/academics/entities/class.entity';
import { ClassSection } from '../modules/academics/entities/class-section.entity';
import { Student } from '../modules/students/entities/student.entity';
import { Guardian } from '../modules/students/entities/guardian.entity';
import { ensureDemoStudents, ensureRoleTestUsers, ensureSecondSchoolMembership } from './seed.util';

/**
 * The account/membership/roster half of the seed, deliberately kept in its
 * own module so it can be imported WITHOUT pulling in `AppModule`.
 *
 * `seed.ts` boots Nest via `NestFactory.createApplicationContext(AppModule)`,
 * and `AppModule` calls `ConfigModule.forRoot()` at module-evaluation time,
 * which validates `DATABASE_URL` and `JWT_SECRET`. That happens on IMPORT, so
 * a `require.main === module` guard does not prevent it: merely importing
 * `seed.ts` from a spec was enough to throw an unhandled rejection in CI,
 * where those variables are not set for the unit-test job. It passed locally
 * only because a developer `.env` happens to supply them.
 *
 * Nothing here touches Nest, config or the DataSource — repositories are
 * passed in — so the seed's ordering invariant stays unit testable.
 */

/** Every repository `seedAccounts` writes through. Passed in rather than
 * pulled off the DataSource so the ordering invariant below is unit
 * testable without booting Nest. */
export interface SeedAccountRepositories {
  userRepository: Repository<User>;
  schoolRepository: Repository<School>;
  userTenantRepository: Repository<UserTenant>;
  academicYearRepository: Repository<AcademicYear>;
  classRepository: Repository<Class>;
  classSectionRepository: Repository<ClassSection>;
  studentRepository: Repository<Student>;
  guardianRepository: Repository<Guardian>;
}

/** Creates/repairs the seed accounts, their memberships and the demo
 * roster, at the default `school`. The *order* of the calls in here is
 * load-bearing — see the ORDER MATTERS comment inside. */
export async function seedAccounts(
  repos: SeedAccountRepositories,
  school: School,
  adminEmail: string,
  passwordHash: string,
): Promise<void> {
  // Check if the designated seed admin already exists (including soft-deleted)
  const existing = await repos.userRepository.findOne({
    where: { email: adminEmail },
    withDeleted: true,
  });

  let admin: User;
  if (existing) {
    if (existing.deleted_at) {
      existing.password_hash = passwordHash;
      existing.status = UserStatus.ACTIVE;
      existing.deleted_at = null;
      await repos.userRepository.save(existing);
      console.log('Restored soft-deleted SUPER_ADMIN account with fresh credentials.');
    } else {
      console.log('SUPER_ADMIN user already exists, skipping creation.');
    }
    admin = existing;
  } else {
    admin = repos.userRepository.create({
      email: adminEmail,
      phone: '01700000000',
      password_hash: passwordHash,
      status: UserStatus.ACTIVE,
      full_name: 'System Administrator',
    });
    await repos.userRepository.save(admin);
    console.log('SUPER_ADMIN user created:');
    console.log(`  Email: ${adminEmail}`);
  }

  // Create the SUPER_ADMIN's membership at the default school, if missing —
  // idempotent the same way the block above is, so a partially-seeded DB
  // (e.g. the admin row survived but its membership was manually deleted)
  // self-heals on the next run instead of erroring.
  const existingMembership = await repos.userTenantRepository.findOne({
    where: { user_id: admin.id, tenant_id: school.id },
  });
  if (!existingMembership) {
    const membership = repos.userTenantRepository.create({
      user_id: admin.id,
      tenant_id: school.id,
      role: UserRole.SUPER_ADMIN,
    });
    await repos.userTenantRepository.save(membership);
    console.log(`  Role: ${membership.role} at ${school.name}`);
  } else if (existingMembership.role !== UserRole.SUPER_ADMIN) {
    existingMembership.role = UserRole.SUPER_ADMIN;
    await repos.userTenantRepository.save(existingMembership);
    console.log(`  Role: reconciled to ${UserRole.SUPER_ADMIN} at ${school.name}`);
  }

  await ensureSecondSchoolMembership(repos.schoolRepository, repos.userTenantRepository, admin.id);

  // [8.9.6]: one account per remaining role, all at the default school —
  // see `seed.util.ts`'s own comment on why this is the manual-testing
  // path for role-gated nav specifically.
  //
  // ORDER MATTERS (#356), do not move this below the
  // `ensureSecondSchoolMembership` call that follows. Memberships are
  // resolved earliest-first (`AuthService.EARLIEST_MEMBERSHIP_ORDER`), so
  // whichever membership is inserted first becomes `memberships[0]` — the
  // tenant `scripts/lighthouse-student-url.mjs` queries for a student id.
  // Demo students are seeded at the default school only, so the default
  // school's membership has to be created before the second school's or
  // that script queries a deliberately empty tenant and the Lighthouse job
  // fails. `seed.spec.ts` pins this.
  await ensureRoleTestUsers(
    repos.userRepository,
    repos.userTenantRepository,
    school.id,
    passwordHash,
  );

  // [8.5.2]: the ADMIN seed account must be multi-membership so the E2E
  // tenant-picker specs have a real picker to land on — same second
  // school the super admin gets above. Deliberately *after*
  // `ensureRoleTestUsers` — see the ordering note above.
  const adminTestUser = await repos.userRepository.findOne({
    where: { email: 'admin@biddaloy.test' },
  });
  if (adminTestUser) {
    await ensureSecondSchoolMembership(
      repos.schoolRepository,
      repos.userTenantRepository,
      adminTestUser.id,
    );
  }

  // [8.13 / #356]: real Student rows at the default school. Without these
  // `scripts/lighthouse-student-url.mjs` has no student detail route to
  // resolve and the whole Lighthouse budget job crashes — see the comment
  // on `ensureDemoStudents`. Seeded only at the default school; the second
  // school stays deliberately empty so the tenant-picker specs still have
  // a visibly different tenant to switch into.
  const parentTestUser = await repos.userRepository.findOne({
    where: { email: 'parent@biddaloy.test' },
  });
  await ensureDemoStudents(
    {
      academicYearRepository: repos.academicYearRepository,
      classRepository: repos.classRepository,
      classSectionRepository: repos.classSectionRepository,
      studentRepository: repos.studentRepository,
      guardianRepository: repos.guardianRepository,
    },
    school.id,
    parentTestUser?.id ?? null,
  );
}
