import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserService, TeacherService } from './users.service';
import { CreateUserDto } from './dto/users.dto';
import { User } from './entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { School } from '../schools/entities/school.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_TENANT_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';
import { UserRole, TeacherDesignation } from '@biddaloy/shared';

/**
 * Integration tests for UserService and TeacherService.
 *
 * These tests run against a real PostgreSQL database and verify:
 * - User CRUD with tenant-scoped membership
 * - Teacher profile creation, section assignment, and updates
 * - Tenant isolation, duplicate detection, and transactional integrity
 */

const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';
// A stand-in for the admin making the request in remove() calls — never the target.
const REQUESTING_ADMIN_ID = '00000000-0000-4000-8000-000000000aaa';

async function seedReferenceData(ds: DataSource): Promise<void> {
  await ds.query('DELETE FROM teacher_class_sections');
  await ds.query('DELETE FROM teachers');
  await ds.query('DELETE FROM user_tenants');
  await ds.query('DELETE FROM users');
  await ds.query('DELETE FROM class_sections');
  await ds.query('DELETE FROM classes');
  await ds.query('DELETE FROM academic_years');
  await ds.query('DELETE FROM schools');

  const schoolRepo = ds.getRepository(School);
  const ayRepo = ds.getRepository(AcademicYear);
  const classRepo = ds.getRepository(Class);
  const sectionRepo = ds.getRepository(ClassSection);

  // Tenant 1
  await schoolRepo.save(
    schoolRepo.create({
      id: SEED_TENANT_ID,
      name: 'Test School',
      slug: 'test-school',
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await ayRepo.save(
    ayRepo.create({
      id: SEED_ACADEMIC_YEAR_ID,
      name: '2026-2027',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await classRepo.save(
    classRepo.create({
      id: SEED_CLASS_1_ID,
      name: 'Class One',
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: SEED_SECTION_1_ID,
      section_name: 'Section A',
      class_id: SEED_CLASS_1_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );

  // Other tenant
  const OTHER_AY_ID = '00000000-0000-4000-8000-000000000099';
  const OTHER_CLASS_ID = '00000000-0000-4000-8000-000000000098';
  const OTHER_SECTION_ID = '00000000-0000-4000-8000-000000000097';
  await schoolRepo.save(
    schoolRepo.create({
      id: OTHER_TENANT,
      name: 'Other School',
      slug: 'other-school',
      tenant_id: OTHER_TENANT,
    }),
  );
  await ayRepo.save(
    ayRepo.create({
      id: OTHER_AY_ID,
      name: 'Other 2026-2027',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: OTHER_TENANT,
    }),
  );
  await classRepo.save(
    classRepo.create({
      id: OTHER_CLASS_ID,
      name: 'Other Class',
      academic_year_id: OTHER_AY_ID,
      tenant_id: OTHER_TENANT,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: OTHER_SECTION_ID,
      section_name: 'Other Section',
      class_id: OTHER_CLASS_ID,
      tenant_id: OTHER_TENANT,
    }),
  );
}

describe('UserService (integration)', () => {
  let service: UserService;
  let userRepo: Repository<User>;
  let userTenantRepo: Repository<UserTenant>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [UserService, TeacherService], [], {
      synchronize: true,
      dropSchema: true,
    });

    service = module.get<UserService>(UserService);
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    userTenantRepo = module.get<Repository<UserTenant>>(getRepositoryToken(UserTenant));
    dataSource = module.get(DataSource);

    await seedReferenceData(dataSource);
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    if (dataSource) {
      await dataSource.query('DELETE FROM teacher_class_sections');
      await dataSource.query('DELETE FROM teachers');
      await dataSource.query('DELETE FROM user_tenants');
      await dataSource.query('DELETE FROM users');
    }
  });

  // ────────────────────────
  //  create()
  // ────────────────────────
  describe('create', () => {
    it('should create a user with email, password, and role membership', async () => {
      const result = await service.create(
        {
          full_name: 'John Doe',
          email: 'john@example.com',
          password: 'secret123',
          role: UserRole.TEACHER,
        },
        TENANT_ID,
      );

      expect(result.user).toBeDefined();
      expect(result.user.full_name).toBe('John Doe');
      expect(result.user.email).toBe('john@example.com');
      expect(result.user.password_hash).not.toBe('secret123'); // bcrypt hash, not plaintext
      expect(result.user.password_hash).toMatch(/^\$2b\$/); // bcrypt prefix

      expect(result.membership).toBeDefined();
      expect(result.membership.user_id).toBe(result.user.id);
      expect(result.membership.tenant_id).toBe(TENANT_ID);
      expect(result.membership.role).toBe(UserRole.TEACHER);
    });

    it('should create a user with phone and no password', async () => {
      const result = await service.create(
        {
          full_name: 'Jane Doe',
          phone: '+8801700000000',
          role: UserRole.PARENT,
        },
        TENANT_ID,
      );

      expect(result.user.full_name).toBe('Jane Doe');
      expect(result.user.phone).toBe('+8801700000000');
      expect(result.user.password_hash).toBeNull();
      expect(result.membership.role).toBe(UserRole.PARENT);
    });

    it('should throw ConflictException when email already exists', async () => {
      await service.create(
        { full_name: 'First', email: 'dup@example.com', password: 'pw', role: UserRole.TEACHER },
        TENANT_ID,
      );

      await expect(
        service.create(
          { full_name: 'Second', email: 'dup@example.com', password: 'pw', role: UserRole.ADMIN },
          TENANT_ID,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow same email in different tenants (email is globally unique)', async () => {
      await service.create(
        {
          full_name: 'User A',
          email: 'shared@example.com',
          password: 'pw',
          role: UserRole.TEACHER,
        },
        TENANT_ID,
      );

      // Same email — should still conflict because email is globally unique
      await expect(
        service.create(
          {
            full_name: 'User B',
            email: 'shared@example.com',
            password: 'pw',
            role: UserRole.ADMIN,
          },
          OTHER_TENANT,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should create a user without email (null email)', async () => {
      const result = await service.create(
        { full_name: 'No Email', phone: '+8801111111111', role: UserRole.STUDENT },
        TENANT_ID,
      );

      expect(result.user.email).toBeNull();
      expect(result.user.phone).toBe('+8801111111111');
    });
  });

  // ────────────────────────
  //  findAll()
  // ────────────────────────
  describe('findAll', () => {
    it('should return paginated users for a tenant', async () => {
      await service.create({ full_name: 'User 1', role: UserRole.TEACHER }, TENANT_ID);
      await service.create({ full_name: 'User 2', role: UserRole.ADMIN }, TENANT_ID);

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should filter by role', async () => {
      await service.create({ full_name: 'Teacher A', role: UserRole.TEACHER }, TENANT_ID);
      await service.create({ full_name: 'Admin A', role: UserRole.ADMIN }, TENANT_ID);

      const result = await service.findAll(
        { role: UserRole.TEACHER, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Teacher A');
    });

    it('should search by full_name (case-insensitive, partial match)', async () => {
      await service.create({ full_name: 'Rahim Uddin', role: UserRole.TEACHER }, TENANT_ID);
      await service.create({ full_name: 'Karim Mia', role: UserRole.TEACHER }, TENANT_ID);

      const result = await service.findAll({ search: 'rahim', page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Rahim Uddin');
    });

    it('should treat % and _ in search as literal text, not wildcards', async () => {
      await service.create({ full_name: 'Rahim Uddin', role: UserRole.TEACHER }, TENANT_ID);
      await service.create({ full_name: '100% Attendance', role: UserRole.TEACHER }, TENANT_ID);

      // A bare % would match every user if unescaped.
      const percent = await service.findAll({ search: '100%', page: 1, limit: 10 }, TENANT_ID);
      expect(percent.data).toHaveLength(1);
      expect(percent.data[0].full_name).toBe('100% Attendance');

      // `_` matches any single character when unescaped — 'R_him' must not find Rahim.
      const underscore = await service.findAll({ search: 'R_him', page: 1, limit: 10 }, TENANT_ID);
      expect(underscore.data).toHaveLength(0);
    });

    it('should search by email', async () => {
      await service.create(
        { full_name: 'User 1', email: 'rahim@example.com', role: UserRole.TEACHER },
        TENANT_ID,
      );
      await service.create(
        { full_name: 'User 2', email: 'karim@example.com', role: UserRole.TEACHER },
        TENANT_ID,
      );

      const result = await service.findAll(
        { search: 'karim@example', page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].email).toBe('karim@example.com');
    });

    it('should combine role and search filters', async () => {
      await service.create({ full_name: 'Rahim Teacher', role: UserRole.TEACHER }, TENANT_ID);
      await service.create({ full_name: 'Rahim Admin', role: UserRole.ADMIN }, TENANT_ID);

      const result = await service.findAll(
        { role: UserRole.ADMIN, search: 'Rahim', page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Rahim Admin');
    });

    // Tenant isolation: a member of tenant A must never surface through
    // tenant B's search, even on an exact name match.
    it("should not find another tenant's member via search", async () => {
      await service.create({ full_name: 'Hidden Member', role: UserRole.TEACHER }, OTHER_TENANT);

      const result = await service.findAll({ search: 'Hidden', page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should enforce tenant isolation', async () => {
      await service.create({ full_name: 'Tenant 1 User', role: UserRole.TEACHER }, TENANT_ID);
      await service.create({ full_name: 'Tenant 2 User', role: UserRole.ADMIN }, OTHER_TENANT);

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Tenant 1 User');
    });

    it('should return empty list when no users match', async () => {
      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ────────────────────────
  //  findOne()
  // ────────────────────────
  describe('findOne', () => {
    it('should return a user by ID', async () => {
      const { user } = await service.create(
        { full_name: 'John Doe', email: 'john@example.com', role: UserRole.TEACHER },
        TENANT_ID,
      );

      const result = await service.findOne(user.id, TENANT_ID);

      expect(result.id).toBe(user.id);
      expect(result.full_name).toBe('John Doe');
      expect(result.email).toBe('john@example.com');
    });

    it('should throw NotFoundException when user does not exist', async () => {
      await expect(
        service.findOne('00000000-0000-4000-8000-000000000000', TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when user is soft-deleted', async () => {
      const { user } = await service.create(
        { full_name: 'Delete Me', role: UserRole.TEACHER },
        TENANT_ID,
      );

      await service.remove(user.id, TENANT_ID, REQUESTING_ADMIN_ID);

      await expect(service.findOne(user.id, TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ────────────────────────
  //  update()
  // ────────────────────────
  describe('update', () => {
    it('should update user email and phone', async () => {
      const { user } = await service.create(
        {
          full_name: 'Update Me',
          email: 'old@example.com',
          phone: '+8801',
          role: UserRole.TEACHER,
        },
        TENANT_ID,
      );

      const updated = await service.update(
        user.id,
        { email: 'new@example.com', phone: '+8802' },
        TENANT_ID,
      );

      expect(updated.email).toBe('new@example.com');
      expect(updated.phone).toBe('+8802');
    });

    it('should clear the phone number when phone is null', async () => {
      const { user } = await service.create(
        { full_name: 'Clear Phone', phone: '+8801711111111', role: UserRole.TEACHER },
        TENANT_ID,
      );

      const updated = await service.update(user.id, { phone: null }, TENANT_ID);

      expect(updated.phone).toBeNull();
    });

    it('should update user full_name', async () => {
      const { user } = await service.create(
        { full_name: 'Original Name', role: UserRole.ADMIN },
        TENANT_ID,
      );

      const updated = await service.update(user.id, { full_name: 'Updated Name' }, TENANT_ID);

      expect(updated.full_name).toBe('Updated Name');
    });

    it('should throw NotFoundException when user does not exist', async () => {
      await expect(
        service.update('00000000-0000-4000-8000-000000000000', { full_name: 'Nope' }, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ────────────────────────
  //  remove()
  // ────────────────────────
  describe('remove', () => {
    it('should remove the tenant membership without soft-deleting the global user', async () => {
      const { user } = await service.create(
        { full_name: 'Delete Me', role: UserRole.TEACHER },
        TENANT_ID,
      );

      await service.remove(user.id, TENANT_ID, REQUESTING_ADMIN_ID);

      // Should not be found via findOne (no membership in this tenant)
      await expect(service.findOne(user.id, TENANT_ID)).rejects.toThrow(NotFoundException);

      // Global user record persists, untouched
      const raw = await userRepo.findOne({ where: { id: user.id } });
      expect(raw).not.toBeNull();
      expect(raw?.deleted_at).toBeNull();
    });

    it('should throw NotFoundException when user does not exist', async () => {
      await expect(
        service.remove('00000000-0000-4000-8000-000000000000', TENANT_ID, REQUESTING_ADMIN_ID),
      ).rejects.toThrow(NotFoundException);
    });

    // Trust-boundary guard: an admin must never lock themselves out of the
    // school, even if the UI check is bypassed.
    it('should reject self-removal with BadRequestException and keep the membership', async () => {
      const { user } = await service.create(
        { full_name: 'Self Admin', role: UserRole.ADMIN },
        TENANT_ID,
      );

      await expect(service.remove(user.id, TENANT_ID, user.id)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.remove(user.id, TENANT_ID, user.id)).rejects.toThrow(
        'You cannot remove your own account from this school',
      );

      // Membership survives the refused attempt
      const stillThere = await service.findOne(user.id, TENANT_ID);
      expect(stillThere.id).toBe(user.id);
    });
  });
});

// ────────────────────────────────────────────────────────────────
//  TeacherService
// ────────────────────────────────────────────────────────────────
describe('TeacherService (integration)', () => {
  let userService: UserService;
  let teacherService: TeacherService;
  let userRepo: Repository<User>;
  let userTenantRepo: Repository<UserTenant>;
  let teacherRepo: Repository<Teacher>;
  let tcsRepo: Repository<TeacherClassSection>;
  let sectionRepo: Repository<ClassSection>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [UserService, TeacherService], [], {
      synchronize: true,
      dropSchema: true,
    });

    userService = module.get<UserService>(UserService);
    teacherService = module.get<TeacherService>(TeacherService);
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    userTenantRepo = module.get<Repository<UserTenant>>(getRepositoryToken(UserTenant));
    teacherRepo = module.get<Repository<Teacher>>(getRepositoryToken(Teacher));
    tcsRepo = module.get<Repository<TeacherClassSection>>(getRepositoryToken(TeacherClassSection));
    sectionRepo = module.get<Repository<ClassSection>>(getRepositoryToken(ClassSection));
    dataSource = module.get(DataSource);

    await seedReferenceData(dataSource);
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    if (dataSource) {
      await dataSource.query('DELETE FROM teacher_class_sections');
      await dataSource.query('DELETE FROM teachers');
      await dataSource.query('DELETE FROM user_tenants');
      await dataSource.query('DELETE FROM users');
    }
  });

  async function createTenantUser(overrides: Partial<CreateUserDto> = {}): Promise<User> {
    const { user } = await userService.create(
      {
        full_name: 'Teacher User',
        email: 'teacher@example.com',
        password: 'pw',
        role: UserRole.TEACHER,
        ...overrides,
      },
      TENANT_ID,
    );
    return user;
  }

  // ────────────────────────
  //  create()
  // ────────────────────────
  describe('create', () => {
    it('should create a teacher profile linked to a user', async () => {
      const user = await createTenantUser();

      const teacher = await teacherService.create(
        {
          user_id: user.id,
          employee_id: 'EMP-001',
          designations: [TeacherDesignation.CLASS_TEACHER],
          subject_specialization: 'Mathematics',
          joining_date: '2026-01-15',
        },
        TENANT_ID,
      );

      expect(teacher).toBeDefined();
      expect(teacher.user_id).toBe(user.id);
      expect(teacher.employee_id).toBe('EMP-001');
      expect(teacher.designations).toContain(TeacherDesignation.CLASS_TEACHER);
      expect(teacher.subject_specialization).toBe('Mathematics');
      expect(teacher.joining_date).toBe('2026-01-15');
      expect(teacher.tenant_id).toBe(TENANT_ID);
      expect(teacher.user).toBeDefined();
      expect(teacher.user.id).toBe(user.id);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      await expect(
        teacherService.create(
          { user_id: '00000000-0000-4000-8000-000000000000', employee_id: 'EMP-001' },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when user is not a member of the tenant', async () => {
      // Create a user but DON'T add them to the tenant
      const user = await userRepo.save(
        userRepo.create({
          full_name: 'No Membership',
          email: 'nomem@example.com',
        }),
      );

      await expect(
        teacherService.create({ user_id: user.id, employee_id: 'EMP-002' }, TENANT_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException when employee_id already exists', async () => {
      const user1 = await createTenantUser();
      await teacherService.create({ user_id: user1.id, employee_id: 'EMP-001' }, TENANT_ID);

      const user2 = await createTenantUser({ email: 'user2@example.com' });
      await expect(
        teacherService.create({ user_id: user2.id, employee_id: 'EMP-001' }, TENANT_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when the user already has a teacher profile', async () => {
      const user = await createTenantUser();
      await teacherService.create({ user_id: user.id, employee_id: 'EMP-A' }, TENANT_ID);

      await expect(
        teacherService.create({ user_id: user.id, employee_id: 'EMP-B' }, TENANT_ID),
      ).rejects.toThrow('already has a teacher profile');
    });

    it('should assign sections when provided', async () => {
      const user = await createTenantUser();

      const teacher = await teacherService.create(
        {
          user_id: user.id,
          employee_id: 'EMP-003',
          assigned_section_ids: [SEED_SECTION_1_ID],
        },
        TENANT_ID,
      );

      // Verify the TCS entries were created
      const tcsEntries = await tcsRepo.find({ where: { teacher_id: teacher.id } });
      expect(tcsEntries).toHaveLength(1);
      expect(tcsEntries[0].section_id).toBe(SEED_SECTION_1_ID);
    });

    it('should throw NotFoundException when assigned sections are from another tenant', async () => {
      const user = await createTenantUser();

      await expect(
        teacherService.create(
          {
            user_id: user.id,
            employee_id: 'EMP-004',
            assigned_section_ids: ['00000000-0000-4000-8000-000000000000'],
          },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create a teacher without designations or sections', async () => {
      const user = await createTenantUser();

      const teacher = await teacherService.create(
        { user_id: user.id, employee_id: 'EMP-005' },
        TENANT_ID,
      );

      expect(teacher).toBeDefined();
      expect(teacher.designations).toEqual([]);
      expect(teacher.subject_specialization).toBeNull();
      expect(teacher.joining_date).toBeNull();
    });
  });

  // ────────────────────────
  //  findAll()
  // ────────────────────────
  describe('findAll', () => {
    it('should return paginated teachers', async () => {
      const u1 = await createTenantUser({ email: 't1@example.com' });
      const u2 = await createTenantUser({ email: 't2@example.com' });
      await teacherService.create({ user_id: u1.id, employee_id: 'EMP-001' }, TENANT_ID);
      await teacherService.create({ user_id: u2.id, employee_id: 'EMP-002' }, TENANT_ID);

      const result = await teacherService.findAll({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should search teachers by user full_name', async () => {
      const u1 = await createTenantUser({ full_name: 'Alice Smith', email: 'alice@example.com' });
      const u2 = await createTenantUser({ full_name: 'Bob Jones', email: 'bob@example.com' });
      await teacherService.create({ user_id: u1.id, employee_id: 'EMP-001' }, TENANT_ID);
      await teacherService.create({ user_id: u2.id, employee_id: 'EMP-002' }, TENANT_ID);

      const result = await teacherService.findAll(
        { search: 'Alice', page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].user.full_name).toBe('Alice Smith');
    });

    it('should enforce tenant isolation', async () => {
      const u1 = await createTenantUser({ email: 't1@example.com' });
      await teacherService.create({ user_id: u1.id, employee_id: 'EMP-001' }, TENANT_ID);

      // Create a teacher in other tenant
      const { user: u2 } = await userService.create(
        { full_name: 'Other Teacher', email: 'other@example.com', role: UserRole.TEACHER },
        OTHER_TENANT,
      );
      const otherTeacher = await teacherService.create(
        { user_id: u2.id, employee_id: 'EMP-002' },
        OTHER_TENANT,
      );

      // Query from tenant 1 — should only see tenant 1's teacher
      const result = await teacherService.findAll({ page: 1, limit: 10 }, TENANT_ID);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].employee_id).toBe('EMP-001');
    });

    it('should filter by user_id (so the promote dialog can exclude existing teachers)', async () => {
      const u1 = await createTenantUser({ email: 't1@example.com' });
      const u2 = await createTenantUser({ email: 't2@example.com' });
      await teacherService.create({ user_id: u1.id, employee_id: 'EMP-001' }, TENANT_ID);
      await teacherService.create({ user_id: u2.id, employee_id: 'EMP-002' }, TENANT_ID);

      const result = await teacherService.findAll(
        { user_id: u2.id, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].user_id).toBe(u2.id);
      expect(result.total).toBe(1);
    });

    it("should not find another tenant's teacher via user_id filter", async () => {
      const { user: otherUser } = await userService.create(
        { full_name: 'Other Teacher', email: 'other-t@example.com', role: UserRole.TEACHER },
        OTHER_TENANT,
      );
      await teacherService.create({ user_id: otherUser.id, employee_id: 'EMP-009' }, OTHER_TENANT);

      const result = await teacherService.findAll(
        { user_id: otherUser.id, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return empty list when no teachers exist', async () => {
      const result = await teacherService.findAll({ page: 1, limit: 10 }, TENANT_ID);
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ────────────────────────
  //  findOne()
  // ────────────────────────
  describe('findOne', () => {
    it('should return a teacher by ID', async () => {
      const user = await createTenantUser();
      const teacher = await teacherService.create(
        { user_id: user.id, employee_id: 'EMP-001' },
        TENANT_ID,
      );

      const result = await teacherService.findOne(teacher.id, TENANT_ID);

      expect(result.id).toBe(teacher.id);
      expect(result.employee_id).toBe('EMP-001');
      expect(result.user).toBeDefined();
      expect(result.user.full_name).toBe('Teacher User');
    });

    it('should throw NotFoundException when teacher does not exist', async () => {
      await expect(
        teacherService.findOne('00000000-0000-4000-8000-000000000000', TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when teacher belongs to a different tenant', async () => {
      const { user } = await userService.create(
        { full_name: 'Other', email: 'other@example.com', role: UserRole.TEACHER },
        OTHER_TENANT,
      );
      const teacher = await teacherService.create(
        { user_id: user.id, employee_id: 'EMP-001' },
        OTHER_TENANT,
      );

      await expect(teacherService.findOne(teacher.id, TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ────────────────────────
  //  update()
  // ────────────────────────
  describe('update', () => {
    it('should update teacher fields', async () => {
      const user = await createTenantUser();
      const teacher = await teacherService.create(
        { user_id: user.id, employee_id: 'EMP-001' },
        TENANT_ID,
      );

      const updated = await teacherService.update(
        teacher.id,
        {
          employee_id: 'EMP-002',
          designations: [TeacherDesignation.SUBJECT_TEACHER],
          subject_specialization: 'Physics',
          joining_date: '2026-06-01',
        },
        TENANT_ID,
      );

      expect(updated.employee_id).toBe('EMP-002');
      expect(updated.designations).toContain(TeacherDesignation.SUBJECT_TEACHER);
      expect(updated.subject_specialization).toBe('Physics');
      expect(updated.joining_date).toBe('2026-06-01');
      expect(updated.user).toBeDefined();
    });

    it('should replace assigned sections', async () => {
      const user = await createTenantUser();
      const teacher = await teacherService.create(
        { user_id: user.id, employee_id: 'EMP-001' },
        TENANT_ID,
      );

      // Assign sections
      await teacherService.update(
        teacher.id,
        { assigned_section_ids: [SEED_SECTION_1_ID] },
        TENANT_ID,
      );

      let tcsEntries = await tcsRepo.find({ where: { teacher_id: teacher.id } });
      expect(tcsEntries).toHaveLength(1);

      // Replace with different sections (empty)
      await teacherService.update(teacher.id, { assigned_section_ids: [] }, TENANT_ID);

      tcsEntries = await tcsRepo.find({ where: { teacher_id: teacher.id } });
      expect(tcsEntries).toHaveLength(0);
    });

    it('should clear sections when assigned_section_ids is empty array', async () => {
      const user = await createTenantUser();
      const teacher = await teacherService.create(
        { user_id: user.id, employee_id: 'EMP-001', assigned_section_ids: [SEED_SECTION_1_ID] },
        TENANT_ID,
      );

      // Verify sections were created
      let tcsEntries = await tcsRepo.find({ where: { teacher_id: teacher.id } });
      expect(tcsEntries).toHaveLength(1);

      // Clear sections
      await teacherService.update(teacher.id, { assigned_section_ids: [] }, TENANT_ID);

      tcsEntries = await tcsRepo.find({ where: { teacher_id: teacher.id } });
      expect(tcsEntries).toHaveLength(0);
    });

    it('should throw NotFoundException when teacher does not exist', async () => {
      await expect(
        teacherService.update(
          '00000000-0000-4000-8000-000000000000',
          { employee_id: 'EMP-001' },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when assigned section does not belong to tenant', async () => {
      const user = await createTenantUser();
      const teacher = await teacherService.create(
        { user_id: user.id, employee_id: 'EMP-001' },
        TENANT_ID,
      );

      await expect(
        teacherService.update(
          teacher.id,
          { assigned_section_ids: ['00000000-0000-4000-8000-000000000000'] },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
