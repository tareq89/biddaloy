import { UserRole, UserStatus } from '@biddaloy/shared';
import { Repository } from 'typeorm';
import { School } from '../modules/schools/entities/school.entity';
import { User } from '../modules/users/entities/user.entity';
import { UserTenant } from '../modules/auth/entities/user-tenant.entity';

/** [8.9.5] manual-testing aid: gives the seed admin a *second* school
 * membership so `/select-school`'s picker actually has something to show
 * — a single-membership account always skips it. Idempotent (safe to
 * call on every seed run, new account or existing one): finds-or-creates
 * both the school and the membership row rather than assuming either is
 * missing.
 *
 * Kept out of `seed.ts` (which runs `seed()` as an unconditional top-level
 * side effect against a real `NestFactory`-booted app) so it can be
 * unit-tested directly against mocked repositories in `seed.util.spec.ts`
 * — same split as `reencrypt-settings.ts`/`reencrypt-settings.util.ts`. */
export async function ensureSecondSchoolMembership(
  schoolRepository: Repository<School>,
  userTenantRepository: Repository<UserTenant>,
  adminId: string,
): Promise<void> {
  let secondSchool = await schoolRepository.findOne({ where: { slug: 'rose-valley-school' } });
  if (!secondSchool) {
    secondSchool = schoolRepository.create({
      name: 'Rose Valley School',
      slug: 'rose-valley-school',
    });
    await schoolRepository.save(secondSchool);
    console.log(`  School: ${secondSchool.name} (${secondSchool.id})`);
  }

  const existingMembership = await userTenantRepository.findOne({
    where: { user_id: adminId, tenant_id: secondSchool.id },
  });
  if (!existingMembership) {
    const membership = userTenantRepository.create({
      user_id: adminId,
      tenant_id: secondSchool.id,
      role: UserRole.ADMIN,
    });
    await userTenantRepository.save(membership);
    console.log(`  Role: ${membership.role} at ${secondSchool.name}`);
  }
}

export interface RoleTestUserSeed {
  email: string;
  role: UserRole;
  fullName: string;
}

/** One account per role — [8.9.6] manual-testing aid: log
 * in as each and compare the sidebar, since role-gated nav (`AppShell`'s
 * `navGroups`) is the one thing in this app that visibly differs per
 * role today; list/detail pages are still permission-gated stubs with no
 * per-record filtering to demonstrate. SUPER_ADMIN got its own
 * `@biddaloy.test` entry in [8.5.2] so the E2E auth fixtures
 * (`e2e/fixtures/auth.setup.ts`) can cover every role from one list —
 * `seed()`'s own `admin@school.com` account predates this and stays as
 * the bootstrap credential. SUPER_ADMIN membership is tenant-scoped
 * like every other role (a `UserTenant` row), so the shared
 * find-or-create loop below covers it with no special casing. */
export const ROLE_TEST_USERS: readonly RoleTestUserSeed[] = [
  { email: 'superadmin@biddaloy.test', role: UserRole.SUPER_ADMIN, fullName: 'Super Admin User' },
  { email: 'admin@biddaloy.test', role: UserRole.ADMIN, fullName: 'Admin User' },
  { email: 'accountant@biddaloy.test', role: UserRole.ACCOUNTANT, fullName: 'Accountant User' },
  { email: 'teacher@biddaloy.test', role: UserRole.TEACHER, fullName: 'Teacher User' },
  { email: 'parent@biddaloy.test', role: UserRole.PARENT, fullName: 'Parent User' },
  { email: 'student@biddaloy.test', role: UserRole.STUDENT, fullName: 'Student User' },
  { email: 'executive@biddaloy.test', role: UserRole.EXECUTIVE, fullName: 'Executive User' },
];

/** Idempotent, same shape as `ensureSecondSchoolMembership`: find-or-
 * create (restoring a soft-deleted account with a fresh password rather
 * than erroring) then find-or-create the membership. All six share
 * `passwordHash` — one already-required `SEED_ADMIN_PASSWORD` env var,
 * not six new ones, for local/dev seed accounts that exist to be logged
 * into by hand. */
export async function ensureRoleTestUsers(
  userRepository: Repository<User>,
  userTenantRepository: Repository<UserTenant>,
  schoolId: string,
  passwordHash: string,
): Promise<void> {
  for (const { email, role, fullName } of ROLE_TEST_USERS) {
    let user = await userRepository.findOne({ where: { email }, withDeleted: true });

    if (!user) {
      user = userRepository.create({
        email,
        password_hash: passwordHash,
        status: UserStatus.ACTIVE,
        full_name: fullName,
      });
      await userRepository.save(user);
      console.log(`  ${role} test user created: ${email}`);
    } else if (user.deleted_at) {
      user.password_hash = passwordHash;
      user.status = UserStatus.ACTIVE;
      user.deleted_at = null;
      await userRepository.save(user);
      console.log(`  ${role} test user restored: ${email}`);
    }

    const existingMembership = await userTenantRepository.findOne({
      where: { user_id: user.id, tenant_id: schoolId },
    });
    if (!existingMembership) {
      const membership = userTenantRepository.create({
        user_id: user.id,
        tenant_id: schoolId,
        role,
      });
      await userTenantRepository.save(membership);
      console.log(`  Role: ${role} at school ${schoolId}`);
    } else if (existingMembership.role !== role) {
      existingMembership.role = role;
      await userTenantRepository.save(existingMembership);
      console.log(`  Role: reconciled to ${role} at school ${schoolId}`);
    }
  }
}
