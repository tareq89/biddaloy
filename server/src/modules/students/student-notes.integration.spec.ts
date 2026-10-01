import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Permission, UserRole } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_SECTION_1_ID, SEED_SECTION_2_ID, SEED_TENANT_ID } from '@test/constants';
import { AuditService } from '../audit/audit.service';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../auth/decorators/require-permissions.decorator';
import { User } from '../users/entities/user.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Student } from './entities/student.entity';
import { StudentNote } from './entities/student-note.entity';
import { StudentNotesService } from './student-notes.service';
import { StudentNotesController } from './student-notes.controller';

const TENANT_B = '00000000-0000-4000-8000-0000039b0001';

describe('StudentNotesService (integration)', () => {
  let service: StudentNotesService;
  let ds: DataSource;
  let studentA: Student; // tenant A, section 1
  let studentA2: Student; // tenant A, section 2
  let adminId: string;
  let teacherUserId: string;

  const admin = () => ({ userId: adminId, role: UserRole.ADMIN, tenantId: SEED_TENANT_ID });
  const teacher = () => ({
    userId: teacherUserId,
    role: UserRole.TEACHER,
    tenantId: SEED_TENANT_ID,
  });

  beforeAll(async () => {
    const mod = await createTestModule(ALL_ENTITIES, [StudentNotesService, AuditService]);
    service = mod.get(StudentNotesService);
    ds = mod.get<DataSource>(getDataSourceToken());
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Notes Tenant B', 'notes-tenant-b', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
  }, 60000);

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    const users = ds.getRepository(User);
    const students = ds.getRepository(Student);
    const mkUser = (tag: string) =>
      users.save({ email: `${tag}-${Math.random()}@notes.test`, full_name: `User ${tag}` });
    adminId = (await mkUser('admin')).id;
    teacherUserId = (await mkUser('teacher')).id;
    const teacherRow = await ds.getRepository(Teacher).save({
      user_id: teacherUserId,
      employee_id: `EMP-${Math.random()}`,
      tenant_id: SEED_TENANT_ID,
      designations: [],
    });
    await ds.getRepository(TeacherClassSection).save({
      teacher_id: teacherRow.id,
      section_id: SEED_SECTION_1_ID,
      tenant_id: SEED_TENANT_ID,
      subject_id: null,
    });
    const mkStudent = (section: string) =>
      students.save(
        students.create({
          full_name: 'Noted Child',
          registration_number: `N-${Math.random().toString(36).slice(2, 10)}`,
          roll_number: Math.floor(Math.random() * 100000),
          class_section_id: section,
          tenant_id: SEED_TENANT_ID,
        } as Partial<Student>),
      );
    studentA = await mkStudent(SEED_SECTION_1_ID);
    studentA2 = await mkStudent(SEED_SECTION_2_ID);
  });

  it('creates and lists a note with author name, newest first', async () => {
    await service.create(studentA.id, { body: 'first' }, admin());
    const second = await service.create(studentA.id, { body: 'second' }, admin());
    const list = await service.list(studentA.id, admin());
    expect(list.map((n) => n.body)).toEqual(['second', 'first']);
    expect(list[0]).toMatchObject({
      id: second.id,
      author: { id: adminId, name: 'User admin' },
    });
  });

  it('isolates tenants: another tenant cannot see or write notes (404)', async () => {
    await service.create(studentA.id, { body: 'secret' }, admin());
    const other = { userId: adminId, role: UserRole.ADMIN, tenantId: TENANT_B };
    await expect(service.list(studentA.id, other)).rejects.toThrow(NotFoundException);
    await expect(service.create(studentA.id, { body: 'x' }, other)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('TEACHER: allowed in own section, 403 outside it', async () => {
    await service.create(studentA.id, { body: 'mine' }, teacher());
    expect(await service.list(studentA.id, teacher())).toHaveLength(1);
    await expect(service.list(studentA2.id, teacher())).rejects.toThrow(ForbiddenException);
    await expect(service.create(studentA2.id, { body: 'x' }, teacher())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('soft delete hides the note from the list but keeps the row; audits create and delete', async () => {
    const note = await service.create(studentA.id, { body: 'gone' }, admin());
    await service.remove(studentA.id, note.id, admin());
    expect(await service.list(studentA.id, admin())).toHaveLength(0);
    const rows = await ds.getRepository(StudentNote).find({ withDeleted: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at).not.toBeNull();
    const audits = await ds.query(
      `SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at`,
      [studentA.id],
    );
    expect(audits.map((a: { action: string }) => a.action)).toEqual(['CREATE', 'DELETE']);
  });

  it('a non-author TEACHER cannot delete; deleting the same note twice is 404', async () => {
    const note = await service.create(studentA.id, { body: 'admin note' }, admin());
    await expect(service.remove(studentA.id, note.id, teacher())).rejects.toThrow(
      ForbiddenException,
    );
    await service.remove(studentA.id, note.id, admin());
    await expect(service.remove(studentA.id, note.id, admin())).rejects.toThrow(NotFoundException);
  });
});

describe('StudentNotesController route gating', () => {
  const proto = StudentNotesController.prototype;

  it('excludes PARENT, STUDENT and ACCOUNTANT on every route (class-level @Roles)', () => {
    const roles: string[] = Reflect.getMetadata(ROLES_KEY, StudentNotesController);
    expect(roles).toEqual([UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER]);
    for (const m of ['list', 'create', 'remove'] as const) {
      // no method-level override that could re-widen the class-level roles
      expect(Reflect.getMetadata(ROLES_KEY, proto[m])).toBeUndefined();
    }
  });

  it('requires the D22 permissions', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.list)).toEqual([
      Permission.STUDENT_NOTES_READ,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.create)).toEqual([
      Permission.STUDENT_NOTES_WRITE,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.remove)).toEqual([
      Permission.STUDENT_NOTES_WRITE,
    ]);
  });
});
