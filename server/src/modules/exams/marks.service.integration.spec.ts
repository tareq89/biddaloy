import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { MarksService } from './marks.service';
import { ResultsService } from './results.service';
import { MarkGridService } from './mark-grid.service';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Subject } from '../academics/entities/subject.entity';
import { School } from '../schools/entities/school.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AttendanceComponentService } from './attendance-component.service';
import { MarksAuthorizationService } from './marks-authorization.util';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID, SEED_TENANT_ID } from '@test/constants';
import {
  EnrollmentStatus,
  ExamComponentKind,
  ExamComponentSource,
  ExamKind,
  ExamStatus,
  MarkStatus,
  UserRole,
} from '@biddaloy/shared';

/** [ACAD-07] A mark save's audit row lists every changed cell, old -> new. */
const TENANT_ID = SEED_TENANT_ID;
const YEAR_ID = '00000000-0000-4000-8000-0000000e0001';
const CLASS_ID = '00000000-0000-4000-8000-0000000e0011';
const SECTION_ID = '00000000-0000-4000-8000-0000000e0021';
const SUBJECT_ID = '00000000-0000-4000-8000-0000000e0031';

type AuditCells = { cells: Array<Record<string, unknown>> };

describe('MarksService audit (integration)', () => {
  let service: MarksService;
  let ds: DataSource;
  let examId: string;
  let studentA: string;
  let studentB: string;
  let compMcq: string;

  beforeAll(async () => {
    const stubAuthz = {
      assertCanRead: async () => undefined,
      assertCanWrite: async () => undefined,
    };
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        ResultsService,
        MarkGridService,
        MarksService,
        AuditService,
        {
          provide: AttendanceComponentService,
          useValue: {
            computeForSection: async () => ({ reason: null, valuesByStudent: new Map() }),
          },
        },
        { provide: MarksAuthorizationService, useValue: stubAuthz },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );
    service = module.get(MarksService);
    ds = module.get(DataSource);

    await ds.getRepository(School).save({
      id: TENANT_ID,
      name: 'Test School',
      slug: 'test-school',
      tenant_id: TENANT_ID,
    });
    await ds.getRepository(AcademicYear).save({
      id: YEAR_ID,
      name: '2026',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: TENANT_ID,
    });
    await ds
      .getRepository(Class)
      .save({ id: CLASS_ID, name: 'Class Five', academic_year_id: YEAR_ID, tenant_id: TENANT_ID });
    await ds.getRepository(ClassSection).save({
      id: SECTION_ID,
      section_name: 'A',
      class_id: CLASS_ID,
      tenant_id: TENANT_ID,
    });
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  // The global beforeEach truncates transactional tables, so rebuild per test.
  beforeEach(async () => {
    // audit_logs.performed_by_user_id has an FK to users(id).
    await ds.query(
      `INSERT INTO users (id, full_name) VALUES ($1, 'Test Admin') ON CONFLICT (id) DO NOTHING`,
      [SEED_ADMIN_USER_ID],
    );
    await ds
      .getRepository(Subject)
      .save({ id: SUBJECT_ID, name_en: 'Physics', code: 'PHY', tenant_id: TENANT_ID });
    const students: string[] = [];
    for (const n of [1, 2]) {
      const st = await ds.getRepository(Student).save({
        full_name: `Kid ${n}`,
        registration_number: `REG-${Math.random()}`,
        roll_number: n,
        class_section_id: SECTION_ID,
        tenant_id: TENANT_ID,
        date_of_birth: new Date('2012-01-01'),
        gender: 'MALE',
        enrollment_status: EnrollmentStatus.ACTIVE,
        preferred_communication: 'SMS',
      } as Partial<Student>);
      await ds.getRepository(Enrollment).save({
        student_id: st.id,
        class_id: CLASS_ID,
        section_id: SECTION_ID,
        academic_year_id: YEAR_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: TENANT_ID,
      });
      students.push(st.id);
    }
    [studentA, studentB] = students;
    const exam = await ds.getRepository(Exam).save({
      tenant_id: TENANT_ID,
      academic_year_id: YEAR_ID,
      class_id: CLASS_ID,
      name: 'Term',
      kind: ExamKind.TERM,
      status: ExamStatus.DRAFT,
    });
    examId = exam.id;
    const comp = await ds.getRepository(ExamComponent).save({
      tenant_id: TENANT_ID,
      exam_id: examId,
      subject_id: SUBJECT_ID,
      name: 'MCQ',
      kind: ExamComponentKind.MCQ,
      source: ExamComponentSource.MANUAL,
      full_marks: '100',
      pass_marks: '33',
      sequence: 1,
    });
    compMcq = comp.id;
  });

  const save = (cells: Array<{ student_id: string; value: string }>) =>
    service.upsertBatch(
      examId,
      {
        section_id: SECTION_ID,
        subject_id: SUBJECT_ID,
        cells: cells.map((c) => ({ ...c, component_id: compMcq, status: MarkStatus.PRESENT })),
      } as never,
      TENANT_ID,
      UserRole.ADMIN,
      SEED_ADMIN_USER_ID,
    );

  const markRows = () =>
    ds.getRepository(AuditLog).find({
      where: { entity_type: 'Mark', entity_id: examId },
      order: { created_at: 'ASC' },
    });

  it('first entry of a cell has no old value', async () => {
    await save([{ student_id: studentA, value: '72' }]);

    const [row] = await markRows();
    expect(row.old_values).toBeNull();
    const cells = (row.new_values as AuditCells).cells;
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ student_id: studentA, component_id: compMcq });
    expect(Number(cells[0].value)).toBe(72);
  });

  it('editing one cell 72 -> 45 records old 72 / new 45 for that student and component; unchanged cells are not listed', async () => {
    await save([
      { student_id: studentA, value: '72' },
      { student_id: studentB, value: '60' },
    ]);
    // Resend both: only A changes.
    await save([
      { student_id: studentA, value: '45' },
      { student_id: studentB, value: '60' },
    ]);

    const rows = await markRows();
    expect(rows).toHaveLength(2);
    const oldCells = (rows[1].old_values as AuditCells).cells;
    const newCells = (rows[1].new_values as AuditCells).cells;
    expect(oldCells).toHaveLength(1);
    expect(newCells).toHaveLength(1);
    expect(oldCells[0]).toMatchObject({ student_id: studentA, component_id: compMcq });
    expect(Number(oldCells[0].value)).toBe(72);
    expect(Number(newCells[0].value)).toBe(45);
    expect(newCells.some((c) => c.student_id === studentB)).toBe(false);
  });
  it('rejects a batch that holds the same student and component twice, writing nothing', async () => {
    await expect(
      save([
        { student_id: studentA, value: '10' },
        { student_id: studentA, value: '20' },
      ]),
    ).rejects.toThrow('same student and component twice');

    expect(await markRows()).toHaveLength(0);
  });

  it('rounds a value to two decimals once, so the stored mark and the audit row agree', async () => {
    await save([{ student_id: studentA, value: '72.456' }]);

    const [row] = await markRows();
    expect((row.new_values as AuditCells).cells[0].value).toBe('72.46');
  });
});
