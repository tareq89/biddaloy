import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ExamComponentKind, ExamKind, ExamStatus, MarkGridState } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID } from '@test/constants';
import { MarkGridService } from './mark-grid.service';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Subject } from '../academics/entities/subject.entity';
import { School } from '../schools/entities/school.entity';

/**
 * [31.3.7b] `MarkGridService.progress` names each outstanding subject
 * (English + Bangla) straight from the database. Exams/components/subjects
 * are transactional tables wiped before every test, so they are re-seeded
 * in `beforeEach`.
 */
describe('MarkGridService.progress (integration)', () => {
  let app: TestingModule;
  let dataSource: DataSource;
  let service: MarkGridService;

  const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000007b2';
  let examId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    dataSource = app.get(DataSource);
    service = app.get(MarkGridService, { strict: false });
    await dataSource
      .getRepository(School)
      .save({ id: OTHER_TENANT_ID, name: 'Progress Other School', slug: 'progress-other' });
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const exam = await dataSource.getRepository(Exam).save({
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      class_id: SEED_CLASS_1_ID,
      name: 'Progress Exam',
      kind: ExamKind.TERM,
      status: ExamStatus.DRAFT,
      tenant_id: SEED_TENANT_ID,
    });
    examId = exam.id;
  });

  async function addComponent(subjectId: string): Promise<void> {
    await dataSource.getRepository(ExamComponent).save({
      exam_id: examId,
      subject_id: subjectId,
      name: 'Written',
      kind: ExamComponentKind.WRITTEN,
      full_marks: '100',
      sequence: 1,
      tenant_id: SEED_TENANT_ID,
    });
  }

  const subjectRepo = () => dataSource.getRepository(Subject);

  it('names each outstanding subject in English and Bangla', async () => {
    const subject = await subjectRepo().save({
      tenant_id: SEED_TENANT_ID,
      name_en: 'Mathematics',
      name_bn: 'গণিত',
      code: 'PRG-M',
    });
    await addComponent(subject.id);

    const { outstanding } = await service.progress(examId, SEED_TENANT_ID);

    expect(outstanding.length).toBeGreaterThan(0);
    for (const row of outstanding) {
      expect(row).toMatchObject({
        subject_id: subject.id,
        subject_name: 'Mathematics',
        subject_name_bn: 'গণিত',
        state: MarkGridState.DRAFT,
      });
    }
  });

  it('still names a soft-deleted subject', async () => {
    const subject = await subjectRepo().save({
      tenant_id: SEED_TENANT_ID,
      name_en: 'History',
      name_bn: 'ইতিহাস',
      code: 'PRG-H',
    });
    await addComponent(subject.id);
    await subjectRepo().softDelete({ id: subject.id });

    const { outstanding } = await service.progress(examId, SEED_TENANT_ID);

    expect(outstanding.length).toBeGreaterThan(0);
    expect(outstanding[0]).toMatchObject({ subject_name: 'History', subject_name_bn: 'ইতিহাস' });
  });

  it("never returns another tenant's subject name", async () => {
    const foreign = await subjectRepo().save({
      tenant_id: OTHER_TENANT_ID,
      name_en: 'Secret',
      name_bn: 'গোপন',
      code: 'PRG-X',
    });
    await addComponent(foreign.id);

    const { outstanding } = await service.progress(examId, SEED_TENANT_ID);

    expect(outstanding.length).toBeGreaterThan(0);
    expect(outstanding[0]).toMatchObject({ subject_name: null, subject_name_bn: null });
  });
});
