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
} from '@test/helpers/sms-credit-ledger.helper';
import { ApplicationEventKind, ApplicationType } from '@biddaloy/shared';
import { Guardian } from '../students/entities/guardian.entity';
import { Student } from '../students/entities/student.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { CommunicationsService } from '../communications/communications.service';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { ApplicationNotifyService } from './application-notify.service';

/**
 * [52.2.6] Decision SMS against the REAL credit ledger: reserves `segments x guardians`
 * under `batch:application:<id>:<event>`; insufficient credit reserves nothing and sends
 * no SMS but still pushes. Recipient lookups are stubbed; everything money-related is real.
 */
describe('ApplicationNotifyService decision SMS credit (integration, 52.2.6)', () => {
  let dataSource: DataSource;
  let logRepo: Repository<CommunicationLog>;
  let credits: SmsCreditService;
  let service: ApplicationNotifyService;
  let queuedJobs: Array<{ name: string; data: any }>;
  let pushes: string[];

  const APP_ID = '00000000-0000-4000-8000-0000000a2107';
  const EVENT_ID = '00000000-0000-4000-8000-0000000e2107';
  const app = {
    id: APP_ID,
    tenant_id: TENANT_ID,
    type: ApplicationType.STUDENT_LEAVE,
    serial_year: 2026,
    serial_no: 45,
    applicant_user_id: 'g1-user',
    applicant_name: 'Tanvir',
    subject_student_id: 'stu-1',
    subject_staff_profile_id: null,
  } as any;
  const event = {
    id: EVENT_ID,
    kind: ApplicationEventKind.APPROVED,
    actor_user_id: SEED_ADMIN_USER_ID,
  } as any;
  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [], []);
    dataSource = module.get<DataSource>(getDataSourceToken());
    logRepo = module.get(getRepositoryToken(CommunicationLog));
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  async function build(grant: number) {
    queuedJobs = [];
    pushes = [];
    credits = makeMeteredCreditService(dataSource);
    await credits.grant(TENANT_ID, grant, { idempotencyKey: 'seed:application' });
    const communications = new CommunicationsService(
      logRepo,
      { add: async (name: string, data: any) => void queuedJobs.push({ name, data }) } as any,
      { findOne: async () => ({}) } as any,
      { findOne: async () => ({}) } as any,
      credits,
    );
    // Real rows: the communication log has FKs to the student and guardian.
    const suffix = Math.random().toString(36).slice(2, 8);
    const guardians = await dataSource.getRepository(Guardian).save(
      ['g1', 'g2'].map((n) => ({
        tenant_id: TENANT_ID,
        full_name: n,
        relationship: 'Father',
        phone: '+8801700000001',
        user_id: null,
      })) as any,
    );
    const student = await dataSource.getRepository(Student).save({
      tenant_id: TENANT_ID,
      full_name: 'Tanvir Hasan',
      registration_number: `REG-${suffix}`,
      roll_number: 1,
      class_section_id: SEED_SECTION_1_ID,
    } as any);
    const fakeManager = {
      findOne: async () => ({
        id: student.id,
        user_id: null,
        full_name: 'Tanvir Hasan',
        guardians: guardians.map((g: any) => ({
          ...g,
          notifications_enabled: true,
          is_primary_contact: false,
          user_id: null,
        })),
      }),
      find: async () => [{ user_id: 'g1-user', role: 'PARENT', user: { status: 'ACTIVE' } }],
    };
    service = new ApplicationNotifyService(
      { sendToUser: async (id: string) => void pushes.push(id) } as any,
      communications,
      credits,
      {
        findById: async () => ({
          id: TENANT_ID,
          name: 'Biddaloy',
          settings: {
            applications: { smsOnDecision: true },
            communications: { sms: { provider: 'test', metering: 'PLATFORM' } },
          },
        }),
      } as any,
      { currentDeciderUserIds: async () => [] } as any,
      { manager: fakeManager } as any,
    );
  }

  beforeEach(async () => {
    await dataSource.query('DELETE FROM sms_credit_ledger WHERE tenant_id = $1', [TENANT_ID]);
    await dataSource.query('DELETE FROM sms_credit_balance WHERE tenant_id = $1', [TENANT_ID]);
  });

  it('reserves segments x guardians under batch:application:<id>:<event>', async () => {
    await build(100);
    await service.onStatusChanged(app, event);

    const reserves = (await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'RESERVE');
    expect(reserves.map((r) => [r.idempotency_key, r.units])).toEqual([
      [`batch:application:${APP_ID}:${EVENT_ID}`, 2],
    ]);
    expect(await balanceFor(dataSource, TENANT_ID)).toEqual({ available: 98, reserved: 2 });
    expect(queuedJobs).toHaveLength(2);
  });

  it('insufficient credit: no reserve, no SMS, push still sent', async () => {
    await build(1);
    await service.onStatusChanged(app, event);

    expect((await ledgerFor(dataSource, TENANT_ID)).filter((r) => r.kind === 'RESERVE')).toEqual(
      [],
    );
    expect(queuedJobs).toHaveLength(0);
    expect(pushes).toEqual(['g1-user']);
  });
});
