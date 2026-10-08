import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID, SEED_TENANT_ID as TENANT_ID } from '@test/constants';
import {
  balanceFor,
  ledgerFor,
  makeMeteredCreditService,
} from '@test/helpers/sms-credit-ledger.helper';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { CommunicationsService } from '../communications/communications.service';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { StudyPlanFlagsScheduler } from './study-plan-flags.scheduler';
import { guardianBody } from './study-plan-flags.messages';
import { UserStatus, countSmsSegments } from '@biddaloy/shared';

/**
 * [66.2.05/#2010] Guardian digest SMS against the REAL credit ledger. One
 * reservation per digest run (`batch:study-plan-digest:<tenant>:<week>`) for
 * every SMS recipient; plans, students and push are stubbed.
 */
describe('StudyPlanFlagsScheduler guardian-digest SMS credit (integration, D26)', () => {
  let ds: DataSource;
  let logRepo: ReturnType<DataSource['getRepository']>;
  let credits: SmsCreditService;
  let jobs: { name: string; data: any }[];
  let pushes: string[];
  let n = 0;
  let week: string;

  const SETTINGS = {
    statusDeadline: '18:00',
    reminderTime: '08:00',
    escalateAfterSchoolDays: 2,
    weeklyDigestTime: '17:00',
    guardianDigestSms: true,
  };
  const body = guardianBody('শিশু', '১-ক', [{ subject: 'বিষয়', periods: 3 }]);
  const units = countSmsSegments(body).segments;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [], []);
    ds = module.get<DataSource>(getDataSourceToken());
    logRepo = module.get(getRepositoryToken(CommunicationLog));
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  beforeEach(() => {
    jobs = [];
    pushes = [];
    week = `2047-W${String(++n).padStart(2, '0')}-${Math.random().toString(36).slice(2, 6)}`;
    credits = makeMeteredCreditService(ds);
  });

  /** A scheduler whose only real parts are the credit ledger and CommunicationsService. */
  function build(opts: {
    noAdmin?: boolean;
    provider?: string;
    metered?: boolean;
    creditService?: SmsCreditService;
  }) {
    const communications = new CommunicationsService(
      logRepo as never,
      { add: async (name: string, data: any) => void jobs.push({ name, data }) } as any,
      { findOne: async () => ({}) } as any,
      { findOne: async () => ({}) } as any,
      credits,
    );
    const guardian = (id: string, phone: string | null) => ({
      id: `g-${id}`,
      tenant_id: TENANT_ID,
      user_id: `gu-${id}`,
      full_name: `Guardian ${id}`,
      phone,
    });
    const student = {
      id: 'kid',
      class_section_id: 's1',
      full_name: 'kid',
      full_name_bn: 'শিশু',
      guardians: [
        guardian('1', '+8801700000001'),
        guardian('2', '+8801700000002'),
        guardian('3', null), // no phone: push only
      ],
    };
    const plan = {
      id: 'p1',
      section_id: 's1',
      subject: { name_bn: 'বিষয়', name_en: 'Subject' },
      section: { section_name: 'ক', class: { name: '১' } },
    };
    return new StudyPlanFlagsScheduler(
      {} as never,
      {
        find: async () => [plan],
        manager: {
          query: async (_sql: string, params: unknown[]) =>
            (params[0] as string[]).map((id) => ({ id })),
        },
      } as never,
      { find: async () => [student] } as never,
      {
        find: async () =>
          opts.noAdmin
            ? []
            : [{ user: { id: SEED_ADMIN_USER_ID, status: UserStatus.ACTIVE, full_name: 'admin' } }],
      } as never,
      { findOne: async () => ({ id: 'y' }) } as never,
      {} as never,
      {
        getResolvedSettings: async () => ({
          communications: opts.provider ? { sms: { provider: opts.provider } } : {},
        }),
      } as never,
      {} as never,
      {} as never,
      { summarize: async () => new Map([['p1', { periods_behind: 3 }]]) } as never,
      {} as never,
      { sendToUser: async (u: string) => void pushes.push(u) } as never,
      communications,
      (opts.creditService ??
        (opts.metered === false ? { isMetered: async () => false } : credits)) as never,
    );
  }

  const reserves = async () =>
    (await ledgerFor(ds, TENANT_ID)).filter(
      (r) => r.kind === 'RESERVE' && r.idempotency_key.includes(week),
    );

  it('SMS is off by default: pushes only, no reservation', async () => {
    await credits.grant(TENANT_ID, 100, { idempotencyKey: `seed:${week}` });
    await build({ provider: 'test' }).runDigest(TENANT_ID, week, {
      ...SETTINGS,
      guardianDigestSms: false,
    });
    expect(pushes.filter((u) => u.startsWith('gu-'))).toHaveLength(3);
    expect(jobs).toHaveLength(0);
    expect(await reserves()).toHaveLength(0);
  });

  it('on + provider + metered + enough credit: one reservation for all SMS recipients', async () => {
    await credits.grant(TENANT_ID, 100, { idempotencyKey: `seed:${week}` });
    const before = await balanceFor(ds, TENANT_ID);
    await build({ provider: 'test' }).runDigest(TENANT_ID, week, SETTINGS);

    const rows = await reserves();
    expect(rows.map((r) => [r.idempotency_key, r.units])).toEqual([
      [`batch:study-plan-digest:${TENANT_ID}:${week}`, units * 2],
    ]);
    const after = await balanceFor(ds, TENANT_ID);
    expect(after.reserved - before.reserved).toBe(units * 2);
    expect(jobs).toHaveLength(2); // the guardian without a phone gets push only
    expect(pushes.filter((u) => u.startsWith('gu-'))).toHaveLength(3);
  });

  it('insufficient credit: no SMS, pushes still sent', async () => {
    // The ledger's own refusal is covered by SmsCreditService specs; here reserve() says no.
    const scheduler = build({
      provider: 'test',
      creditService: {
        isMetered: async () => true,
        reserve: async () => ({ ok: false }),
      } as never,
    });
    await scheduler.runDigest(TENANT_ID, week, SETTINGS);
    expect(jobs).toHaveLength(0);
    expect(pushes.filter((u) => u.startsWith('gu-'))).toHaveLength(3);
    expect(await reserves()).toHaveLength(0);
  });

  it('no ADMIN/EXECUTIVE sender: no reservation, no SMS, pushes still sent', async () => {
    await credits.grant(TENANT_ID, 100, { idempotencyKey: `seed:${week}` });
    await build({ provider: 'test', noAdmin: true }).runDigest(TENANT_ID, week, SETTINGS);
    expect(await reserves()).toHaveLength(0);
    expect(jobs).toHaveLength(0);
    expect(pushes.filter((u) => u.startsWith('gu-'))).toHaveLength(3);
  });

  it('unmetered tenant: SMS goes out without a reservation', async () => {
    await build({ provider: 'test', metered: false }).runDigest(TENANT_ID, week, SETTINGS);
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.data.batchId === undefined)).toBe(true);
    expect(await reserves()).toHaveLength(0);
  });
});
