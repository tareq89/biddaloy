import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  CommunicationMedium,
  ExamComponentKind,
  ExamKind,
  ExamStatus,
  MarkGridState,
  MarkStatus,
} from '@biddaloy/shared';
// Copies of test/constants.ts (that dir sits outside the lint project's rootDir).
const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const SEED_ADMIN_USER_ID = '00000000-0000-4000-8000-000000000010';
const SEED_ACADEMIC_YEAR_ID = '00000000-0000-4000-8000-000000000020';
const SEED_CLASS_1_ID = '00000000-0000-4000-8000-000000000030';
const SEED_SECTION_1_ID = '00000000-0000-4000-8000-000000000040';
import { MarksSmsService } from './marks-sms.service';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Mark } from './entities/mark.entity';
import { MarkGrid } from './entities/mark-grid.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { Student } from '../students/entities/student.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { ReminderBatch } from '../communications/entities/reminder-batch.entity';
import { SmsCreditService } from '../communications/credits/sms-credit.service';

/** Test-only: a grid with `n` students, one reachable guardian each, one 25-mark component. */
export async function seedGrid(
  ds: DataSource,
  n = 2,
  state: MarkGridState = MarkGridState.SUBMITTED,
) {
  const sfx = randomUUID().slice(0, 8);
  const subject = await ds.getRepository(Subject).save({
    tenant_id: TENANT_ID,
    name_en: `Math ${sfx}`,
    code: sfx,
  } as Subject);
  const exam = await ds.getRepository(Exam).save({
    tenant_id: TENANT_ID,
    academic_year_id: SEED_ACADEMIC_YEAR_ID,
    class_id: SEED_CLASS_1_ID,
    name: `Term ${sfx}`,
    kind: ExamKind.TERM,
    status: ExamStatus.DRAFT,
  } as Exam);
  const comp = await ds.getRepository(ExamComponent).save({
    tenant_id: TENANT_ID,
    exam_id: exam.id,
    subject_id: subject.id,
    name: 'Written',
    kind: ExamComponentKind.WRITTEN,
    full_marks: '25',
    sequence: 1,
  } as ExamComponent);
  const grid = await ds.getRepository(MarkGrid).save({
    tenant_id: TENANT_ID,
    exam_id: exam.id,
    section_id: SEED_SECTION_1_ID,
    subject_id: subject.id,
    state,
  } as MarkGrid);
  for (let i = 1; i <= n; i++) {
    const guardian = await ds.getRepository(Guardian).save({
      full_name: `G${i} ${sfx}`,
      relationship: 'Father',
      phone: `017${Math.floor(10000000 + Math.random() * 89999999)}`,
      is_primary_contact: true,
      notifications_enabled: true,
      preferred_communication: CommunicationMedium.SMS,
      tenant_id: TENANT_ID,
    } as Guardian);
    const student = await ds.getRepository(Student).save({
      full_name: `Student ${i} ${sfx}`,
      registration_number: `MS-${i}-${sfx}`,
      roll_number: 50000 + Math.floor(Math.random() * 40000),
      class_section_id: SEED_SECTION_1_ID,
      tenant_id: TENANT_ID,
      guardians: [guardian],
    } as Student);
    await ds.getRepository(Mark).save({
      tenant_id: TENANT_ID,
      exam_id: exam.id,
      student_id: student.id,
      subject_id: subject.id,
      component_id: comp.id,
      value: '18',
      status: MarkStatus.PRESENT,
    } as Mark);
  }
  return { grid, exam, subject };
}

export function makeMarksSms(
  ds: DataSource,
  credits: SmsCreditService,
  queue: { add: (name: string, data: any) => Promise<unknown> },
) {
  return new MarksSmsService(
    ds.getRepository(MarkGrid),
    ds.getRepository(CommunicationLog),
    ds.getRepository(ReminderBatch),
    queue as any,
    credits,
    { record: async () => undefined } as any,
  );
}

export { SEED_ADMIN_USER_ID, TENANT_ID };
