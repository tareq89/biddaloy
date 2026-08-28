import { UserRole, UserStatus } from '@biddaloy/shared';
import { FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm';
import { School } from '../modules/schools/entities/school.entity';
import { User } from '../modules/users/entities/user.entity';
import { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import { AcademicYear } from '../modules/academics/entities/academic-year.entity';
import { Class } from '../modules/academics/entities/class.entity';
import { ClassSection } from '../modules/academics/entities/class-section.entity';
import { Student } from '../modules/students/entities/student.entity';
import { Guardian } from '../modules/students/entities/guardian.entity';

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

/** One test account per role, for manual role-based UI checks and the
 * E2E auth fixtures. */
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

/** The academic chain + student roster the demo/CI database needs.
 *
 * Why this exists (#356): the Lighthouse job profiles the *student detail*
 * route, and `scripts/lighthouse-student-url.mjs` resolves that route by
 * asking the API for the first student in the seeded tenant. Before this,
 * the seed created a `student@biddaloy.test` login but zero `Student`
 * rows, so the resolver exited 1 and the whole perf gate crashed. The
 * roster below is deliberately small-but-real — several classes, two
 * sections each, a handful of students per section — so both the list
 * route (pagination, class column, search) and the detail route
 * (guardian card, class/section, enrollment) render something meaningful
 * instead of one degenerate row.
 *
 * `Student.class_section_id` is non-nullable, so the whole academic chain
 * (academic year → class → section) has to exist first; it is created here
 * rather than assumed. */
export const DEMO_ACADEMIC_YEAR = {
  name: '2026-2027',
  start_date: '2026-01-01',
  end_date: '2026-12-31',
} as const;

export interface DemoClassSeed {
  name: string;
  numericGrade: number;
  sections: readonly string[];
}

export const DEMO_CLASSES: readonly DemoClassSeed[] = [
  { name: 'Class 6', numericGrade: 6, sections: ['A', 'B'] },
  { name: 'Class 7', numericGrade: 7, sections: ['A', 'B'] },
  { name: 'Class 8', numericGrade: 8, sections: ['A'] },
];

/** Three per section, in section order — enough for the list route to show
 * a populated table and for roll numbers to be a real 1..N sequence. */
export const DEMO_STUDENTS_PER_SECTION = 3;

/** Names are cycled over the roster so every seeded student is a plausible
 * person rather than "Student 7". Length is coprime-ish with the roster
 * size on purpose so the same name does not land in the same slot twice. */
const DEMO_STUDENT_NAMES: readonly string[] = [
  'Nusrat Jahan',
  'Tanvir Ahmed',
  'Sadia Islam',
  'Rakibul Hasan',
  'Farhana Akter',
  'Imran Kabir',
  'Mahmuda Khatun',
  'Shakib Rahman',
  'Priya Chowdhury',
  'Arif Hossain',
  'Sumaiya Binte Alam',
  'Jubayer Siddique',
  'Rima Das',
  'Naimul Islam',
  'Tasnim Rahman',
];

const DEMO_GUARDIAN_NAMES: readonly string[] = [
  'Abdul Karim',
  'Rehana Begum',
  'Mizanur Rahman',
  'Shahnaz Parvin',
  'Golam Mostafa',
];

export interface DemoStudentRepositories {
  academicYearRepository: Repository<AcademicYear>;
  classRepository: Repository<Class>;
  classSectionRepository: Repository<ClassSection>;
  studentRepository: Repository<Student>;
  guardianRepository: Repository<Guardian>;
}

export interface DemoStudentSeedResult {
  classes: number;
  sections: number;
  students: number;
  guardians: number;
}

/** Restores a soft-deleted seed row instead of leaving it deleted.
 *
 * Two different index shapes are in play here, and they need different
 * lookups before this is safe to call:
 *
 * - **Plain unique index** (no `WHERE deleted_at IS NULL`) —
 *   `students(tenant_id, registration_number)`,
 *   `students(class_section_id, roll_number)`,
 *   `classes(name, academic_year_id, tenant_id)`. A soft-deleted row still
 *   occupies the key, so at most one row can ever match and a blind insert
 *   on the next run would fail. `findOne({ withDeleted: true })` is correct.
 * - **Partial unique index** (`WHERE "deleted_at" IS NULL`) —
 *   `academic_years(name, tenant_id)`,
 *   `class_sections(class_id, section_name)`. Soft-deleted rows are outside
 *   the index, so a deleted `2026-2027` can legitimately coexist with a live
 *   one. Those call sites must go through `findLivePreferred` below, or they
 *   risk undeleting the dead row into a collision with the live one.
 *
 * `guardians` has no unique index at all; restoring there is idempotence,
 * not constraint avoidance. */
function undelete<T extends { deleted_at: Date | null }>(row: T): T {
  row.deleted_at = null;
  return row;
}

/** Find-or-create lookup for the *partial*-unique-index entities described
 * above: return the live row if there is one, and only fall back to a
 * soft-deleted row when nothing live owns the key (in which case restoring
 * it cannot collide). */
async function findLivePreferred<T extends ObjectLiteral>(
  repository: Repository<T>,
  where: FindOptionsWhere<T>,
): Promise<T | null> {
  const live = await repository.findOne({ where });
  if (live) return live;
  return repository.findOne({ where, withDeleted: true });
}

/** Idempotent, in exactly the same find-or-create shape as
 * `ensureRoleTestUsers` above: safe to re-run against a database that is
 * already fully seeded, partially seeded, or has had rows soft-deleted by
 * hand. Everything created here is scoped to `schoolId` — no row is
 * written without an explicit `tenant_id`. */
export async function ensureDemoStudents(
  repos: DemoStudentRepositories,
  schoolId: string,
  guardianUserId: string | null = null,
): Promise<DemoStudentSeedResult> {
  const {
    academicYearRepository,
    classRepository,
    classSectionRepository,
    studentRepository,
    guardianRepository,
  } = repos;

  // --- academic year -------------------------------------------------
  let year = await findLivePreferred(academicYearRepository, {
    name: DEMO_ACADEMIC_YEAR.name,
    tenant_id: schoolId,
  });
  if (!year) {
    // Only claim `is_current` if the tenant has no current year: the
    // partial unique index allows exactly one, and a dev database may
    // already have picked one by hand.
    const existingCurrent = await academicYearRepository.findOne({
      where: { tenant_id: schoolId, is_current: true },
    });
    year = academicYearRepository.create({
      name: DEMO_ACADEMIC_YEAR.name,
      start_date: new Date(DEMO_ACADEMIC_YEAR.start_date),
      end_date: new Date(DEMO_ACADEMIC_YEAR.end_date),
      is_current: !existingCurrent,
      tenant_id: schoolId,
    });
    await academicYearRepository.save(year);
    console.log(`  Academic year: ${year.name} (${year.id})`);
  } else if (year.deleted_at) {
    await academicYearRepository.save(undelete(year));
  }

  const result: DemoStudentSeedResult = { classes: 0, sections: 0, students: 0, guardians: 0 };

  // --- guardians -----------------------------------------------------
  // One guardian per name, reused across siblings. The first is linked to
  // the `parent@biddaloy.test` account when one is supplied, so `/portal`
  // (measured as that user by scripts/lighthouse-auth.cjs) has real
  // children to render instead of an empty state.
  const guardians: Guardian[] = [];
  for (const [index, fullName] of DEMO_GUARDIAN_NAMES.entries()) {
    const email = `guardian${index + 1}@biddaloy.test`;
    let guardian = await guardianRepository.findOne({
      where: { email, tenant_id: schoolId },
      withDeleted: true,
    });
    if (!guardian) {
      guardian = guardianRepository.create({
        full_name: fullName,
        relationship: index % 2 === 0 ? 'Father' : 'Mother',
        phone: `01710${String(100000 + index).slice(-6)}`,
        email,
        is_primary_contact: true,
        tenant_id: schoolId,
        user_id: index === 0 ? guardianUserId : null,
      });
      await guardianRepository.save(guardian);
      result.guardians += 1;
    } else {
      let dirty = false;
      if (guardian.deleted_at) {
        undelete(guardian);
        dirty = true;
      }
      // Re-link on re-run: an older seed may have created this guardian
      // before the portal account existed.
      if (index === 0 && guardianUserId && guardian.user_id !== guardianUserId) {
        guardian.user_id = guardianUserId;
        dirty = true;
      }
      if (dirty) await guardianRepository.save(guardian);
    }
    guardians.push(guardian);
  }

  // --- classes, sections, students ------------------------------------
  let rosterIndex = 0;
  for (const classSeed of DEMO_CLASSES) {
    let klass = await classRepository.findOne({
      where: { name: classSeed.name, academic_year_id: year.id, tenant_id: schoolId },
      withDeleted: true,
    });
    if (!klass) {
      klass = classRepository.create({
        name: classSeed.name,
        numeric_grade: classSeed.numericGrade,
        academic_year_id: year.id,
        tenant_id: schoolId,
      });
      await classRepository.save(klass);
      result.classes += 1;
    } else if (klass.deleted_at) {
      await classRepository.save(undelete(klass));
    }

    for (const sectionName of classSeed.sections) {
      let section = await findLivePreferred(classSectionRepository, {
        class_id: klass.id,
        section_name: sectionName,
        tenant_id: schoolId,
      });
      if (!section) {
        section = classSectionRepository.create({
          class_id: klass.id,
          section_name: sectionName,
          capacity: 30,
          tenant_id: schoolId,
        });
        await classSectionRepository.save(section);
        result.sections += 1;
      } else if (section.deleted_at) {
        await classSectionRepository.save(undelete(section));
      }

      for (let roll = 1; roll <= DEMO_STUDENTS_PER_SECTION; roll += 1) {
        const registrationNumber = `${DEMO_ACADEMIC_YEAR.name}-${String(rosterIndex + 1).padStart(4, '0')}`;
        const fullName = DEMO_STUDENT_NAMES[rosterIndex % DEMO_STUDENT_NAMES.length] as string;
        const guardian = guardians[rosterIndex % guardians.length];
        rosterIndex += 1;

        const existing = await studentRepository.findOne({
          where: { registration_number: registrationNumber, tenant_id: schoolId },
          withDeleted: true,
        });
        if (existing) {
          if (existing.deleted_at) await studentRepository.save(undelete(existing));
          continue;
        }

        const student = studentRepository.create({
          full_name: fullName,
          registration_number: registrationNumber,
          roll_number: roll,
          class_section_id: section.id,
          date_of_birth: new Date(`${2012 - classSeed.numericGrade + 6}-03-15`),
          gender: rosterIndex % 2 === 0 ? 'female' : 'male',
          home_address: `House ${rosterIndex}, Road ${classSeed.numericGrade}, Dhaka`,
          tenant_id: schoolId,
          // `cascade: ['insert']` on the relation writes the
          // student_guardians join row as part of this save.
          guardians: guardian ? [guardian] : [],
        });
        await studentRepository.save(student);
        result.students += 1;
      }
    }
  }

  if (result.students > 0 || result.classes > 0) {
    console.log(
      `  Demo roster: +${result.classes} classes, +${result.sections} sections, ` +
        `+${result.students} students, +${result.guardians} guardians`,
    );
  }
  return result;
}
