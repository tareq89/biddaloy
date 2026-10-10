import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { EnrollmentStatus, HomeworkGradingMode, HomeworkSubmissionStatus } from '@biddaloy/shared';
import {
  HomeworkDefaulterScheduler,
  HOMEWORK_DEFAULTER_SWEEP_QUEUE,
} from './homework-defaulter.scheduler';
import { HomeworkNoticeService } from './homework-notice.service';
import { SchoolsService } from '../schools/schools.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';
import { Homework } from './entities/homework.entity';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkSubmission } from './entities/homework-submission.entity';

/**
 * Real-DB tests for the defaulter sweep (#2042): a submission row exists only
 * after an upload, so "no row" must count as a defaulter.
 */
describe('HomeworkDefaulterScheduler (integration)', () => {
  const TENANT = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000096';

  let dataSource: DataSource;
  let scheduler: HomeworkDefaulterScheduler;
  let tenantIds: string[];
  const notify = vi.fn(async (..._args: unknown[]) => undefined);

  let sectionId: string;
  let homeworkId: string;
  let seq = 0;

  // The sweep runs against "yesterday" in the tenant timezone (UTC here).
  const yesterday = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      HomeworkDefaulterScheduler,
      { provide: getQueueToken(HOMEWORK_DEFAULTER_SWEEP_QUEUE), useValue: {} },
      {
        provide: SchoolsService,
        useValue: {
          findAll: async () => tenantIds.map((id) => ({ id })),
          getResolvedSettings: async () => ({ region: { timezone: 'UTC' } }),
        },
      },
      { provide: HomeworkNoticeService, useValue: { notifyDefaulters: notify } },
    ]);
    scheduler = module.get(HomeworkDefaulterScheduler);
    dataSource = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  // The global setup resets all tables before every test, so seed per test.
  beforeEach(async () => {
    notify.mockClear();
    tenantIds = [TENANT];
    seq += 1000;
    const schoolRepo = dataSource.getRepository(School);
    for (const id of [TENANT, TENANT_B]) {
      if (!(await schoolRepo.findOne({ where: { id } }))) {
        await schoolRepo.save({ id, name: id, slug: `school-${id.slice(-4)}` });
      }
    }
    const year = await dataSource.getRepository(AcademicYear).save({
      name: `Defaulter Year ${Date.now()}-${seq}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_current: false,
      tenant_id: TENANT,
    });
    const cls = await dataSource.getRepository(Class).save({
      name: 'Def Class',
      academic_year_id: year.id,
      tenant_id: TENANT,
      numeric_grade: 7,
    });
    sectionId = (
      await dataSource
        .getRepository(ClassSection)
        .save({ section_name: 'D', class_id: cls.id, tenant_id: TENANT })
    ).id;
    const subject = await dataSource
      .getRepository(Subject)
      .save({
        tenant_id: TENANT,
        name_en: 'DEFMATH',
        code: `D${String(Date.now()).slice(-8)}${seq}`,
      });
    homeworkId = (
      await dataSource.getRepository(Homework).save({
        title: 'Defaulter HW',
        subject_id: subject.id,
        class_id: cls.id,
        grading_mode: HomeworkGradingMode.TICK,
        tenant_id: TENANT,
      })
    ).id;
  });

  const student = (status: EnrollmentStatus = EnrollmentStatus.ACTIVE) => {
    seq += 1;
    return dataSource.getRepository(Student).save({
      full_name: `Def Student ${seq}`,
      registration_number: `DEF-${Date.now()}-${seq}`,
      roll_number: 1000 + seq,
      class_section_id: sectionId,
      tenant_id: TENANT,
      enrollment_status: status,
    });
  };

  const assign = (target: { section_id?: string; student_id?: string }, tenant_id = TENANT) =>
    dataSource.getRepository(HomeworkAssignment).save({
      homework_id: homeworkId,
      section_id: null,
      student_id: null,
      assigned_date: '2026-01-01',
      due_date: yesterday,
      tenant_id,
      ...target,
    });

  const submit = (assignment_id: string, student_id: string, status: HomeworkSubmissionStatus) =>
    dataSource
      .getRepository(HomeworkSubmission)
      .save({ assignment_id, student_id, status, tenant_id: TENANT });

  const notifiedIds = (): string[] =>
    notify.mock.calls.flatMap((c) => (c[2] as Student[]).map((s) => s.id));

  const cleanup = (id: string) => dataSource.getRepository(HomeworkAssignment).delete({ id });

  it('notifies non-uploaders (no row) and not the uploader', async () => {
    const [up, a, b] = [await student(), await student(), await student()];
    const asg = await assign({ section_id: sectionId });
    await submit(asg.id, up.id, HomeworkSubmissionStatus.SUBMITTED);

    await scheduler.process();

    expect(notifiedIds()).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(notifiedIds()).not.toContain(up.id);
    await cleanup(asg.id);
  });

  it('PARTIAL and DONE are not defaulters; NOT_SUBMITTED row is', async () => {
    const [p, d, n] = [await student(), await student(), await student()];
    const asg = await assign({ section_id: sectionId });
    await submit(asg.id, p.id, HomeworkSubmissionStatus.PARTIAL);
    await submit(asg.id, d.id, HomeworkSubmissionStatus.DONE);
    await submit(asg.id, n.id, HomeworkSubmissionStatus.NOT_SUBMITTED);

    await scheduler.process();

    expect(notifiedIds()).toContain(n.id);
    expect(notifiedIds()).not.toContain(p.id);
    expect(notifiedIds()).not.toContain(d.id);
    await cleanup(asg.id);
  });

  it('withdrawn student is not a defaulter', async () => {
    const gone = await student(EnrollmentStatus.TRANSFERRED);
    const asg = await assign({ section_id: sectionId });

    await scheduler.process();

    expect(notifiedIds()).not.toContain(gone.id);
    await cleanup(asg.id);
  });

  it('student-level assignment targets only that student', async () => {
    const [one, other] = [await student(), await student()];
    const asg = await assign({ student_id: one.id });

    await scheduler.process();

    expect(notifiedIds()).toContain(one.id);
    expect(notifiedIds()).not.toContain(other.id);
    await cleanup(asg.id);
  });

  it("tenant B's assignments are never read during tenant A's sweep", async () => {
    await student();
    const asg = await assign({ section_id: sectionId }, TENANT_B);

    await scheduler.process();

    expect(notify.mock.calls.filter((c) => (c[0] as { id: string }).id === asg.id)).toHaveLength(0);
    await cleanup(asg.id);
  });
});
