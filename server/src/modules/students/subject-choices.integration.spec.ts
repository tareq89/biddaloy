import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { SubjectChoicesService } from './subject-choices.service';
import { SubjectService } from '../academics/subjects.service';
import { SchoolSettingsReader } from '../schools/settings/school-settings-reader.service';
import { AuditService } from '../audit/audit.service';
import { StudentSubjectChoice } from './entities/student-subject-choice.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';

/**
 * [35.1.8] Real-DB round trip. Needs migrations applied (the
 * trg_ssc_copy_choice_group trigger and one-pick-per-group index live
 * there), so no synchronize/dropSchema; rows are created per test and
 * removed with the schools at the end.
 */
describe('SubjectChoicesService choice groups (integration)', () => {
  let choices: SubjectChoicesService;
  let subjects: SubjectService;
  let ds: DataSource;
  const A = '00000000-0000-4000-8000-0000000b1001';
  const B = '00000000-0000-4000-8000-0000000b1002';

  let yearId: string, classId: string, studentId: string;
  let islam: string, hindu: string;
  let subjIslam: string, subjHindu: string;

  const one = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;

  async function seedTenant(t: string, tag: string) {
    await ds.query(`INSERT INTO schools (id, name, slug) VALUES ($1,$2,$3)`, [t, tag, tag]);
    const y = await one(
      `INSERT INTO academic_years (name,start_date,end_date,tenant_id) VALUES ('2026','2026-01-01','2026-12-31',$1) RETURNING id`,
      [t],
    );
    const c = await one(
      `INSERT INTO classes (name,academic_year_id,tenant_id) VALUES ('Six',$1,$2) RETURNING id`,
      [y, t],
    );
    const sec = await one(
      `INSERT INTO class_sections (class_id,section_name,tenant_id) VALUES ($1,'A',$2) RETURNING id`,
      [c, t],
    );
    const st = await one(
      `INSERT INTO students (full_name,registration_number,roll_number,class_section_id,tenant_id) VALUES ('S','R1',1,$1,$2) RETURNING id`,
      [sec, t],
    );
    return { y, c, st };
  }

  async function clean() {
    for (const t of [A, B]) {
      for (const tbl of [
        'student_subject_choices',
        'students',
        'class_sections',
        'class_subjects',
        'subjects',
        'classes',
        'academic_years',
      ]) {
        await ds.query(`DELETE FROM ${tbl} WHERE tenant_id=$1`, [t]);
      }
    }
    await ds.query(`DELETE FROM schools WHERE id IN ($1,$2)`, [A, B]);
  }

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      SubjectChoicesService,
      SubjectService,
      {
        provide: SchoolSettingsReader,
        useValue: { organisationVocabulary: async () => ({ shifts: [], versions: [], groups: [] }) },
      },
      { provide: AuditService, useValue: { record: async () => undefined } },
    ]);
    choices = module.get(SubjectChoicesService);
    subjects = module.get(SubjectService);
    ds = module.get(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    await clean();
    await ds?.destroy();
  });

  beforeEach(async () => {
    await clean();
    const a = await seedTenant(A, 'cg-a');
    yearId = a.y;
    classId = a.c;
    studentId = a.st;
    subjIslam = (await subjects.create({ name_en: 'Islam', code: 'ISL' }, A)).id;
    subjHindu = (await subjects.create({ name_en: 'Hindu', code: 'HIN' }, A)).id;
    islam = (
      await subjects.attachToClass(
        classId,
        { subject_id: subjIslam, academic_year_id: yearId, choice_group: 'Religion' },
        A,
      )
    ).id;
    hindu = (
      await subjects.attachToClass(
        classId,
        { subject_id: subjHindu, academic_year_id: yearId, choice_group: 'Religion' },
        A,
      )
    ).id;
  });

  const rows = () =>
    ds.getRepository(StudentSubjectChoice).find({ where: { student_id: studentId } });

  it('pick Islam then Hindu leaves exactly one row in group Religion', async () => {
    await choices.setChoice(studentId, { class_subject_id: islam }, A);
    await choices.setChoice(studentId, { class_subject_id: hindu }, A);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0].class_subject_id).toBe(hindu);
    expect(r[0].choice_group).toBe('Religion');
  });

  it("tenant B cannot pick tenant A's offering (404)", async () => {
    const b = await seedTenant(B, 'cg-b');
    await expect(choices.setChoice(b.st, { class_subject_id: islam }, B)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('detaching an offering drops its picks; re-attach + re-pick works', async () => {
    await choices.setChoice(studentId, { class_subject_id: hindu }, A);
    await subjects.detachFromClass(classId, subjHindu, yearId, A);
    expect(await rows()).toHaveLength(0);
    const again = await subjects.attachToClass(
      classId,
      { subject_id: subjHindu, academic_year_id: yearId, choice_group: 'Religion' },
      A,
    );
    await choices.setChoice(studentId, { class_subject_id: again.id }, A);
    expect(await rows()).toHaveLength(1);
  });

  it('removing a subject drops its picks', async () => {
    await choices.setChoice(studentId, { class_subject_id: hindu }, A);
    await subjects.remove(subjHindu, A);
    expect(await rows()).toHaveLength(0);
  });

  it('merging two groups a student already picked from is 409', async () => {
    const s3 = (await subjects.create({ name_en: 'Art', code: 'ART' }, A)).id;
    const s4 = (await subjects.create({ name_en: 'Music', code: 'MUS' }, A)).id;
    const art = (
      await subjects.attachToClass(
        classId,
        { subject_id: s3, academic_year_id: yearId, choice_group: 'Arts' },
        A,
      )
    ).id;
    await subjects.attachToClass(
      classId,
      { subject_id: s4, academic_year_id: yearId, choice_group: 'Arts' },
      A,
    );
    await choices.setChoice(studentId, { class_subject_id: art }, A);
    await choices.setChoice(studentId, { class_subject_id: islam }, A);
    await expect(
      subjects.updateClassSubject(classId, s3, { academic_year_id: yearId, choice_group: 'Religion' }, A),
    ).rejects.toThrow(ConflictException);
  });
});
