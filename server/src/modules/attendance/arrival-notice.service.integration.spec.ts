import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import {
  ArrivalNoticeChannel,
  ArrivalNoticeMode,
  ArrivalNoticeStatus,
  AttendanceStatus,
  CommunicationTrigger,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID, SEED_TENANT_ID } from '@test/constants';
import { AttendanceModule } from './attendance.module';
import { AuthModule } from '../auth/auth.module';
import { ArrivalNoticeService } from './arrival-notice.service';
import { ArrivalNoticeSubscription } from './entities/arrival-notice-subscription.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { SchoolsService } from '../schools/schools.service';
import { School } from '../schools/entities/school.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { localToday } from '../../common/time';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';

/** [84.2.2] Real DB + real queue; the service is built directly (the module wiring is 84.3). */
describe('ArrivalNoticeService (integration)', () => {
  let dataSource: DataSource;
  let queue: Queue;
  let service: ArrivalNoticeService;
  const T = SEED_TENANT_ID;
  const suffix = Date.now();
  // The service only sends for the school's today (the text says "today").
  const DATE = localToday('Asia/Dhaka');
  const students: string[] = [];
  const subIds: string[] = [];

  async function setSettings(arrival: object, metered: boolean) {
    await dataSource.getRepository(School).update(
      { id: T },
      {
        settings: {
          version: 1,
          region: { timezone: 'Asia/Dhaka' },
          attendance: { arrivalNotice: arrival },
          communications: { sms: { metering: metered ? 'PLATFORM' : 'OFF', provider: 'test' } },
        } as any,
      },
    );
  }

  async function logs() {
    return dataSource
      .getRepository(CommunicationLog)
      .find({ where: { tenant_id: T, trigger: CommunicationTrigger.ARRIVAL_NOTICE } });
  }

  // The suite resets tables between tests, so fixtures are rebuilt per test.
  async function seed() {
    students.length = 0;
    subIds.length = 0;
    const year = await dataSource.getRepository(AcademicYear).save({
      name: `Arrival Year ${suffix}-${Math.random()}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: T,
    });
    const klass = await dataSource
      .getRepository(Class)
      .save({ name: 'Arrival Class', academic_year_id: year.id, tenant_id: T });
    const section = await dataSource
      .getRepository(ClassSection)
      .save({ section_name: 'AR', class_id: klass.id, tenant_id: T });

    // 3 students; only the first two have a subscription (one PUSH, one SMS).
    for (let i = 0; i < 3; i++) {
      const g = await dataSource.getRepository(Guardian).save({
        full_name: `Arrival G${i}`,
        relationship: 'Father',
        phone: `0171000${suffix % 10000}${i}`,
        notifications_enabled: true,
        tenant_id: T,
        user_id: null,
      } as any);
      const s = await dataSource.getRepository(Student).save({
        full_name: `Arrival S${i}`,
        registration_number: `ARR-${suffix}-${Math.random()}-${i}`,
        roll_number: 900 + i,
        class_section_id: section.id,
        tenant_id: T,
        guardians: [g],
      } as any);
      students.push(s.id);
      if (i < 2) {
        const sub = await dataSource.getRepository(ArrivalNoticeSubscription).save({
          tenant_id: T,
          student_id: s.id,
          guardian_id: g.id,
          status: ArrivalNoticeStatus.ACTIVE,
          mode: ArrivalNoticeMode.RECURRING,
          // PUSH needs a user id on the guardian; keep the fixture to SMS for both.
          channel: ArrivalNoticeChannel.SMS,
        });
        subIds.push(sub.id);
      }
    }
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [
        ConfigModule.forRoot({ isGlobal: true }),
        BullModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: { url: config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379' },
          }),
        }),
        AttendanceModule,
        AuthModule,
      ],
    );
    dataSource = module.get<DataSource>(getDataSourceToken());
    queue = module.get<Queue>(getQueueToken(COMMUNICATIONS_QUEUE));
    service = new ArrivalNoticeService(
      dataSource,
      queue,
      module.get(SchoolsService, { strict: false }),
      module.get(SmsCreditService, { strict: false }),
    );
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  const run = () =>
    service.sendArrivalNotices({
      tenantId: T,
      date: DATE,
      students: students.map((studentId) => ({
        studentId,
        status: AttendanceStatus.PRESENT,
        occurredAt: new Date('2026-03-02T03:05:00Z'),
      })),
      takenBy: { kind: 'TEACHER', userId: SEED_ADMIN_USER_ID },
    });

  it('3 present students, 2 subscribed -> 2 logs; a second call the same day adds none', async () => {
    await seed();
    await setSettings({ enabled: true, smsAllowed: true }, false);
    vi.spyOn(queue, 'add').mockResolvedValue({} as any);
    const first = await run();
    const second = await run();
    expect(first.queued).toBe(2);
    expect(second.queued).toBe(0); // unique index: reference_key arrival:<date>:<student>:<guardian>
    expect((await logs()).filter((l) => students.includes(l.student_id!))).toHaveLength(2);
  });

  it('SMS on a metered tenant writes a RESERVE ledger row for the log', async () => {
    await seed();
    await dataSource.query(`DELETE FROM sms_credit_balance WHERE tenant_id = $1`, [T]);
    await dataSource.query(
      `INSERT INTO sms_credit_balance (tenant_id, available, reserved, updated_at) VALUES ($1, 100, 0, now())`,
      [T],
    );
    await setSettings({ enabled: true, smsAllowed: true }, true);
    const next = await service.sendArrivalNotices({
      tenantId: T,
      date: DATE, // seed() made new students -> a fresh key
      students: [{ studentId: students[0], status: AttendanceStatus.LATE, occurredAt: new Date() }],
      takenBy: { kind: 'TEACHER', userId: SEED_ADMIN_USER_ID },
    });
    expect(next.queued).toBe(1);
    const log = (await logs()).find((l) =>
      l.reference_key?.startsWith(`arrival:${DATE}:${students[0]}`),
    )!;
    const ledger = await dataSource.query(
      `SELECT kind FROM sms_credit_ledger WHERE tenant_id = $1 AND idempotency_key = $2`,
      [T, `batch:${log.id}`],
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0].kind).toBe('RESERVE');
  });
});
