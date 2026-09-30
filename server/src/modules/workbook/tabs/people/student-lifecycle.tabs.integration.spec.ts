import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import { PublicExamType, StudentLifecycleEventType } from '@biddaloy/shared';
import { School } from '../../../schools/entities/school.entity';
import { User } from '../../../users/entities/user.entity';
import { Student } from '../../../students/entities/student.entity';
import { Enrollment } from '../../../students/entities/enrollment.entity';
import { StudentLifecycleEvent } from '../../../students/entities/student-lifecycle-event.entity';
import { StudentNote } from '../../../students/entities/student-note.entity';
import { StudentPublicExam } from '../../../students/entities/student-public-exam.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { toCell } from '../../codec/cell-format';
import type { ExportContext, ImportContext, TabSpec } from '../../codec/tab-spec';
import { studentsTab } from './students.tab';
import { studentLifecycleEventsTab } from './student-lifecycle-events.tab';
import { studentNotesTab } from './student-notes.tab';
import { studentPublicExamsTab } from './student-public-exams.tab';

/**
 * [39.1.4] Round-trip (export -> wipe -> restore -> compare) for the three
 * Epic 39 tabs and the five new `students` columns, against real Postgres.
 * The wipe is a raw delete, not `tab.remove`, so restore has to recreate the
 * rows from cells alone — the same path a workbook restore takes.
 */
describe('student lifecycle tabs (round trip, integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  const repo = <T extends object>(e: new () => T): Repository<T> =>
    module.get<Repository<T>>(getRepositoryToken(e));

  const TENANT = '33333333-3333-4333-8333-333333333333';
  const EMAIL = 'author@lifecycle-tabs.test';

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await module?.close();
  });

  async function wipe() {
    const m = dataSource.manager;
    for (const e of [StudentLifecycleEvent, StudentNote, StudentPublicExam, Enrollment]) {
      await m
        .createQueryBuilder()
        .delete()
        .from(e)
        .where('tenant_id = :t', { t: TENANT })
        .execute();
    }
    await m
      .createQueryBuilder()
      .delete()
      .from(Student)
      .where('tenant_id = :t', { t: TENANT })
      .execute();
    for (const e of [ClassSection, Class, AcademicYear]) {
      await m
        .createQueryBuilder()
        .delete()
        .from(e)
        .where('tenant_id = :t', { t: TENANT })
        .execute();
    }
    await m.createQueryBuilder().delete().from(User).where('email = :e', { e: EMAIL }).execute();
    await m.createQueryBuilder().delete().from(School).where('id = :t', { t: TENANT }).execute();
  }

  beforeEach(async () => {
    await wipe();
    await repo(School).save(
      repo(School).create({ id: TENANT, name: 'Lifecycle School', slug: 'lifecycle-tabs' }),
    );
  });

  async function seedWorld() {
    const author = await repo(User).save(
      repo(User).create({ email: EMAIL, phone: null, full_name: 'Author', password_hash: null }),
    );
    const year = await repo(AcademicYear).save(
      repo(AcademicYear).create({
        name: '2026-lc',
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        is_current: true,
        tenant_id: TENANT,
      }),
    );
    const klass = await repo(Class).save(
      repo(Class).create({
        name: 'Six-lc',
        numeric_grade: 6,
        academic_year_id: year.id,
        tenant_id: TENANT,
      }),
    );
    const section = await repo(ClassSection).save(
      repo(ClassSection).create({
        class_id: klass.id,
        section_name: 'A',
        capacity: null,
        tenant_id: TENANT,
      }),
    );
    const student = await repo(Student).save(
      repo(Student).create({
        full_name: 'Karim Uddin',
        registration_number: 'LC-001',
        roll_number: 1,
        class_section_id: section.id,
        tenant_id: TENANT,
        father_name: 'Abdul Karim',
        mother_name: 'Rahima Begum',
        religion: 'Islam',
        birth_reg_no: '20122604150000001',
        health_notes: 'Mild asthma',
      }),
    );
    const enrollment = await repo(Enrollment).save(
      repo(Enrollment).create({
        student_id: student.id,
        class_id: klass.id,
        section_id: section.id,
        academic_year_id: year.id,
        tenant_id: TENANT,
      }),
    );
    return { author, year, klass, section, student, enrollment };
  }

  type World = Awaited<ReturnType<typeof seedWorld>>;

  const exportCtx = (w: World): ExportContext => ({
    keyOf: (tab, id) => {
      if (tab === 'students' && id === w.student.id) return w.student.registration_number;
      if (tab === 'users' && id === w.author.id) return EMAIL;
      if (tab === 'academic_years' && id === w.year.id) return w.year.name;
      if (tab === 'enrollments' && id === w.enrollment.id) return 'ENR-KEY';
      if (tab === 'sections' && id === w.section.id) return `${w.klass.name}|${w.year.name}|A`;
      if (tab === 'classes' && id === w.klass.id) return `${w.klass.name}|${w.year.name}`;
      return '';
    },
  });

  const importCtx = (w: World): ImportContext => ({
    tenantId: TENANT,
    warn: () => {},
    ref: (tab, key) => {
      if (tab === 'students' && key === w.student.registration_number) return w.student.id;
      if (tab === 'users' && key === EMAIL) return w.author.id;
      if (tab === 'academic_years' && key === w.year.name) return w.year.id;
      if (tab === 'enrollments' && key === 'ENR-KEY') return w.enrollment.id;
      if (tab === 'sections' && key === `${w.klass.name}|${w.year.name}|A`) return w.section.id;
      if (tab === 'classes' && key === `${w.klass.name}|${w.year.name}`) return w.klass.id;
      return undefined;
    },
  });

  /** Loads the tenant's rows, renders them to cells, deletes them, restores from cells. */
  async function roundTrip<E, R>(tab: TabSpec<E, R>, w: World): Promise<void> {
    const cellsList = (await tab.load(TENANT, dataSource.manager)).map((entity) => {
      const row = tab.toRow(entity, exportCtx(w));
      return Object.fromEntries(
        tab.columns.map((c) => [c.key, String(toCell(c.type, row[c.key]) ?? '')]),
      );
    });
    expect(cellsList.length).toBeGreaterThan(0);
    await dataSource.manager
      .createQueryBuilder()
      .delete()
      .from(tab.entity as never)
      .where('tenant_id = :t', { t: TENANT })
      .execute();
    for (const [i, cells] of cellsList.entries()) {
      const parsed = tab.fromRow(cells, i + 2, importCtx(w));
      if ('errors' in parsed) throw new Error(JSON.stringify(parsed.errors));
      await tab.upsert(parsed.row, null, TENANT, dataSource.manager);
    }
  }

  it('lifecycle events survive, including destination and the nullable recorder', async () => {
    const w = await seedWorld();
    const repoE = repo(StudentLifecycleEvent);
    const base = { tenant_id: TENANT, student_id: w.student.id, enrollment_id: w.enrollment.id };
    await repoE.save([
      repoE.create({
        ...base,
        academic_year_id: w.year.id,
        event_type: StudentLifecycleEventType.WITHDRAWN,
        occurred_on: '2026-05-10',
        reason: 'Family relocated',
        destination: null,
        remark: 'left mid-term',
        recorded_by_user_id: w.author.id,
      }),
      repoE.create({
        ...base,
        academic_year_id: w.year.id,
        event_type: StudentLifecycleEventType.TRANSFERRED_OUT,
        occurred_on: '2026-06-15',
        reason: 'Father transferred',
        destination: 'Dhaka Residential Model College',
        recorded_by_user_id: null,
      }),
    ]);
    const before = await repoE.find({
      where: { tenant_id: TENANT },
      order: { occurred_on: 'ASC' },
    });

    await roundTrip(studentLifecycleEventsTab, w);

    const after = await repoE.find({ where: { tenant_id: TENANT }, order: { occurred_on: 'ASC' } });
    const pick = (e: StudentLifecycleEvent) => ({
      type: e.event_type,
      on: e.occurred_on,
      reason: e.reason,
      destination: e.destination,
      remark: e.remark,
      recorder: e.recorded_by_user_id,
      enrollment: e.enrollment_id,
      year: e.academic_year_id,
      created: e.created_at.toISOString(),
    });
    expect(after.map(pick)).toEqual(before.map(pick));
  });

  it('notes survive with author and original timestamp', async () => {
    const w = await seedWorld();
    const repoN = repo(StudentNote);
    await repoN.save(
      repoN.create({
        tenant_id: TENANT,
        student_id: w.student.id,
        author_user_id: w.author.id,
        body: 'Parents asked for a meeting.',
        created_at: new Date('2026-03-01T09:30:00.000Z'),
      }),
    );

    await roundTrip(studentNotesTab, w);

    const [note] = await repoN.find({ where: { tenant_id: TENANT } });
    expect(note).toMatchObject({
      body: 'Parents asked for a meeting.',
      author_user_id: w.author.id,
    });
    expect(note?.created_at.toISOString()).toBe('2026-03-01T09:30:00.000Z');
  });

  it('public exams survive, including gpa', async () => {
    const w = await seedWorld();
    const repoX = repo(StudentPublicExam);
    await repoX.save([
      repoX.create({
        tenant_id: TENANT,
        student_id: w.student.id,
        exam_type: PublicExamType.JSC,
        board: 'Dhaka',
        roll_no: '410021',
        registration_no: 'REG-410021',
        gpa: '4.50',
        passing_year: 2024,
      }),
      repoX.create({
        tenant_id: TENANT,
        student_id: w.student.id,
        exam_type: PublicExamType.SSC,
        board: 'Dhaka',
        roll_no: '520033',
        registration_no: 'REG-520033',
        gpa: null,
        passing_year: 2026,
      }),
    ]);

    await roundTrip(studentPublicExamsTab, w);

    const after = await repoX.find({
      where: { tenant_id: TENANT },
      order: { passing_year: 'ASC' },
    });
    expect(
      after.map((x) => [x.exam_type, x.roll_no, x.registration_no, x.gpa, x.passing_year]),
    ).toEqual([
      ['JSC', '410021', 'REG-410021', '4.50', 2024],
      ['SSC', '520033', 'REG-520033', null, 2026],
    ]);
  });

  it('the five student columns survive export and restore', async () => {
    const w = await seedWorld();
    const [loaded] = await studentsTab.load(TENANT, dataSource.manager);
    const row = studentsTab.toRow(loaded!, exportCtx(w));
    const cells = Object.fromEntries(
      studentsTab.columns.map((c) => [c.key, String(toCell(c.type, row[c.key]) ?? '')]),
    );
    await repo(Student).update(w.student.id, {
      father_name: null,
      mother_name: null,
      religion: null,
      birth_reg_no: null,
      health_notes: null,
    });

    const parsed = studentsTab.fromRow(cells, 2, importCtx(w));
    if ('errors' in parsed) throw new Error(JSON.stringify(parsed.errors));
    const existing = await repo(Student).findOneOrFail({
      where: { id: w.student.id },
      relations: ['guardians'],
    });
    await studentsTab.upsert(
      { ...parsed.row, id: w.student.id },
      existing,
      TENANT,
      dataSource.manager,
    );

    const after = await repo(Student).findOneByOrFail({ id: w.student.id });
    expect({
      father: after.father_name,
      mother: after.mother_name,
      religion: after.religion,
      birth: after.birth_reg_no,
      health: after.health_notes,
    }).toEqual({
      father: 'Abdul Karim',
      mother: 'Rahima Begum',
      religion: 'Islam',
      birth: '20122604150000001',
      health: 'Mild asthma',
    });
  });
});
