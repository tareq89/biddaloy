import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_TENANT_ID as TENANT_ID,
} from '@test/constants';
import {
  balanceFor,
  ledgerFor,
  makeMeteredCreditService,
  makeProcessor,
  runJob,
} from '@test/helpers/sms-credit-ledger.helper';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { Guardian } from '../students/entities/guardian.entity';
import { Student } from '../students/entities/student.entity';
import { ResultSmsService } from './result-sms.service';
import {
  CommunicationMedium,
  CommunicationStatus,
  ExamStatus,
  countSmsSegments,
} from '@biddaloy/shared';

/**
 * [#1317] Exam-result SMS against the REAL credit ledger. Before the fix the
 * reservation (`exam-result-sms:<examId>`, one unit per recipient) had no job
 * data for the worker, so it was never settled. Exam/result lookups are
 * stubbed; the log repo, ledger and worker are real.
 */
describe('ResultSmsService metered SMS credit (integration, #1317)', () => {
  let dataSource: DataSource;
  let logRepo: Repository<CommunicationLog>;
  let credits: SmsCreditService;
  let service: ResultSmsService;
  let queuedJobs: Array<{ name: string; data: any }>;
  let failAddFor: Set<number>;
  let addCalls: number;

  const EXAM_ID = '00000000-0000-4000-8000-0000000e1317';
  const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000001319';
  let bodies: string[];

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [], []);
    dataSource = module.get<DataSource>(getDataSourceToken());
    logRepo = module.get(getRepositoryToken(CommunicationLog));
    const { School } = await import('../schools/entities/school.entity');
    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT_ID } }))) {
      await schoolRepo.save({ id: OTHER_TENANT_ID, name: 'Other 1319', slug: 'other-1319' });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    queuedJobs = [];
    failAddFor = new Set();
    addCalls = 0;
    credits = makeMeteredCreditService(dataSource);
    await credits.grant(TENANT_ID, 100, { idempotencyKey: 'seed:result-sms' });

    // Two students, one reachable guardian each.
    const students: Student[] = [];
    for (const n of [1, 2]) {
      const guardian = await dataSource.getRepository(Guardian).save({
        full_name: `Guardian ${n}`,
        relationship: 'Father',
        phone: `0173333333${n}`,
        is_primary_contact: true,
        notifications_enabled: true,
        preferred_communication: CommunicationMedium.SMS,
        tenant_id: TENANT_ID,
      });
      const student = await dataSource.getRepository(Student).save({
        full_name: `Student ${n}`,
        registration_number: `RS-${n}-${Date.now()}-${Math.random()}`,
        roll_number: Math.floor(Math.random() * 100000),
        class_section_id: SEED_SECTION_1_ID,
        tenant_id: TENANT_ID,
        guardians: [guardian],
      });
      students.push({ ...student, guardians: [guardian] } as Student);
    }

    service = new ResultSmsService(
      {
        findOne: async () => ({ id: EXAM_ID, status: ExamStatus.PUBLISHED, name: 'Mid Term' }),
      } as any,
      {
        find: async () =>
          students.map((s) => ({ student_id: s.id, gpa: 4.5, grade: 'A', is_fail: false })),
      } as any,
      { find: async () => students } as any,
      logRepo,
      {
        add: async (name: string, data: any) => {
          addCalls += 1;
          if (failAddFor.has(addCalls)) throw new Error('redis down');
          queuedJobs.push({ name, data });
        },
      } as any,
      credits,
      { record: async () => undefined } as any,
    );
    bodies = students.map((s) => `${s.full_name}'s result for "Mid Term": GPA 4.5, Grade A.`);
  }, 30000);

  const send = () => service.sendForExam(EXAM_ID, TENANT_ID, SEED_ADMIN_USER_ID);
  const totalUnits = () => bodies.reduce((sum, b) => sum + countSmsSegments(b).segments, 0);

  it('reserves total SEGMENTS (not recipients) under batch:<batchId>; worker DEBITs each log', async () => {
    await send();

    const reserves = (await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'RESERVE');
    expect(reserves).toHaveLength(1);
    expect(reserves[0].units).toBe(totalUnits());
    const bare = queuedJobs[0].data.batchId as string;
    expect(bare).toMatch(new RegExp(`^exam-result-sms:${EXAM_ID}:`));
    expect(reserves[0].idempotency_key).toBe(`batch:${bare}`);
    expect(queuedJobs.every((j) => j.data.batchId === bare)).toBe(true);
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({
      available: 100 - totalUnits(),
      reserved: totalUnits(),
    });

    const processor = makeProcessor(dataSource, credits, 'ACCEPTED');
    for (const job of queuedJobs) await runJob(processor, job.data);

    expect((await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'DEBIT')).toHaveLength(
      2,
    );
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({
      available: 100 - totalUnits(),
      reserved: 0,
    });
    const logs = await logRepo.find({ where: { tenant_id: TENANT_ID } });
    expect(logs.every((l) => (l.metadata as any)?.credit === 'DEBITED')).toBe(true);
  });

  it('REJECTED provider outcome releases every share', async () => {
    await send();
    const processor = makeProcessor(dataSource, credits, 'REJECTED');
    for (const job of queuedJobs) await runJob(processor, job.data);

    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({ available: 100, reserved: 0 });
  });

  it('a queue.add failure releases only that log; the others stay reserved until processed', async () => {
    failAddFor.add(1);
    const outcome = await send();
    expect(outcome.queued).toBe(1);

    const failed = (await logRepo.find({ where: { tenant_id: TENANT_ID } })).filter(
      (l) => l.status === CommunicationStatus.FAILED,
    );
    expect(failed).toHaveLength(1);
    const failedUnits = countSmsSegments(failed[0].message_body).segments;
    const release = (await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'RELEASE');
    expect(release.map((r) => [r.idempotency_key, r.units])).toEqual([
      [`log:${failed[0].id}:settle`, failedUnits],
    ]);
    // Still held: the one queued log's share.
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({
      available: 100 - (totalUnits() - failedUnits),
      reserved: totalUnits() - failedUnits,
    });

    await runJob(makeProcessor(dataSource, credits, 'ACCEPTED'), queuedJobs[0].data);
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({
      available: 100 - (totalUnits() - failedUnits),
      reserved: 0,
    });
  });

  it("leaves another tenant's balance and ledger untouched", async () => {
    await credits.grant(OTHER_TENANT_ID, 50, { idempotencyKey: 'seed:result-sms-other' });
    const otherBefore = await ledgerFor(dataSource, OTHER_TENANT_ID);

    await send();
    const processor = makeProcessor(dataSource, credits, 'ACCEPTED');
    for (const job of queuedJobs) await runJob(processor, job.data);

    expect(await balanceFor(dataSource, OTHER_TENANT_ID)).toEqual({ available: 50, reserved: 0 });
    expect(await ledgerFor(dataSource, OTHER_TENANT_ID)).toEqual(otherBefore);
  });
});
