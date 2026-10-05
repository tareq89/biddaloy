import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SchoolStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { School } from '../entities/school.entity';
import { TenantStatusService } from '../tenant-status.service';
import { AdminNoticeService } from './admin-notice.service';
import { TrialService } from './trial.service';
import { DAY_MS } from './trial.constants';

describe('TrialService (integration)', () => {
  let ds: DataSource;
  let trial: TrialService;
  const notices = { notifyAdmins: vi.fn().mockResolvedValue(undefined) };
  const tenantStatus = { invalidate: vi.fn().mockResolvedValue(undefined) };
  const env: Record<string, string | undefined> = {};
  const now = new Date('2026-10-01T00:00:00Z');

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      TrialService,
      AuditService,
      { provide: AdminNoticeService, useValue: notices },
      { provide: TenantStatusService, useValue: tenantStatus },
      { provide: ConfigService, useValue: { get: (k: string) => env[k] } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    trial = module.get(TrialService);
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  beforeEach(() => {
    notices.notifyAdmins.mockClear();
    tenantStatus.invalidate.mockClear();
    delete env.TRIAL_DAYS;
    delete env.TRIAL_SEAT_LIMIT;
  });

  const newSchool = async (trialEndsInDays: number | null): Promise<string> => {
    const id = randomUUID();
    await ds.getRepository(School).save({
      id,
      tenant_id: id,
      name: `Trial ${id.slice(0, 6)}`,
      slug: `trial-${id.slice(0, 8)}`,
      trial_ends_at:
        trialEndsInDays === null ? null : new Date(now.getTime() + trialEndsInDays * DAY_MS),
    });
    return id;
  };
  const load = (id: string) => ds.getRepository(School).findOneOrFail({ where: { id } });

  it('startTrial applies the D32 defaults (30 days, 10 seats) when the env is unset', async () => {
    const id = await newSchool(null);
    await ds.transaction((m) => trial.startTrial(id, m, now));
    const s = await load(id);
    expect(s.seat_limit).toBe(10);
    expect(s.trial_ends_at!.getTime()).toBe(now.getTime() + 30 * DAY_MS);
  });

  it('startTrial honours TRIAL_DAYS / TRIAL_SEAT_LIMIT', async () => {
    env.TRIAL_DAYS = '14';
    env.TRIAL_SEAT_LIMIT = '25';
    const id = await newSchool(null);
    await ds.transaction((m) => trial.startTrial(id, m, now));
    const s = await load(id);
    expect(s.seat_limit).toBe(25);
    expect(s.trial_ends_at!.getTime()).toBe(now.getTime() + 14 * DAY_MS);
  });

  it('sends each warning once, then suspends at the end and keeps the school row', async () => {
    const id = await newSchool(6.5);

    await trial.runDaily(now);
    expect(notices.notifyAdmins).toHaveBeenCalledWith(id, 'trial_warning_d7', expect.anything());
    await trial.runDaily(new Date(now.getTime() + DAY_MS)); // still inside the d7 window
    const d7Calls = notices.notifyAdmins.mock.calls.filter(
      (c) => c[0] === id && c[1] === 'trial_warning_d7',
    );
    expect(d7Calls).toHaveLength(1);

    await trial.runDaily(new Date(now.getTime() + 5 * DAY_MS)); // 1.5 days left
    await trial.runDaily(new Date(now.getTime() + 5.5 * DAY_MS));
    expect(notices.notifyAdmins.mock.calls.filter((c) => c[1] === 'trial_warning_d2')).toHaveLength(
      1,
    );
    expect((await load(id)).status).toBe(SchoolStatus.ACTIVE);

    await trial.runDaily(new Date(now.getTime() + 7 * DAY_MS));
    const s = await load(id);
    expect(s.status).toBe(SchoolStatus.SUSPENDED);
    expect(s.status_reason).toBe('TRIAL_EXPIRED');
    expect(s.deleted_at).toBeNull(); // D39: data is kept
    expect(tenantStatus.invalidate).toHaveBeenCalledWith(id);
    expect(notices.notifyAdmins).toHaveBeenCalledWith(id, 'trial_ended');

    // A second run does not suspend or notify again.
    notices.notifyAdmins.mockClear();
    await trial.runDaily(new Date(now.getTime() + 8 * DAY_MS));
    expect(notices.notifyAdmins).not.toHaveBeenCalledWith(id, 'trial_ended');
  });

  it('never touches a school with no trial', async () => {
    const id = await newSchool(null);
    await trial.runDaily(new Date(now.getTime() + 400 * DAY_MS));
    expect((await load(id)).status).toBe(SchoolStatus.ACTIVE);
    expect(notices.notifyAdmins.mock.calls.some((c) => c[0] === id)).toBe(false);
  });

  it('extend reactivates a trial-expired school, resets warnings, and sets the seat limit', async () => {
    const id = await newSchool(-1);
    await trial.runDaily(now);
    expect((await load(id)).status).toBe(SchoolStatus.SUSPENDED);

    const s = await trial.extend(
      id,
      { days: 14, seat_limit: 40, reason: 'sales call' },
      { userId: null },
      now,
    );
    expect(s.status).toBe(SchoolStatus.ACTIVE);
    expect(s.status_reason).toBeNull();
    expect(s.seat_limit).toBe(40);
    expect(s.trial_ends_at!.getTime()).toBe(now.getTime() + 14 * DAY_MS);
    expect(s.onboarding?.trial_warnings).toEqual([]);
    expect(tenantStatus.invalidate).toHaveBeenCalledWith(id);
  });

  it('extend does not reactivate a school suspended for another reason', async () => {
    const id = await newSchool(5);
    await ds
      .getRepository(School)
      .update(id, { status: SchoolStatus.SUSPENDED, status_reason: 'unpaid' });
    const s = await trial.extend(id, { days: 5, reason: 'x' }, { userId: null }, now);
    expect(s.status).toBe(SchoolStatus.SUSPENDED);
    expect(s.status_reason).toBe('unpaid');
  });

  it('an extend that lands between load and expire keeps the school active', async () => {
    const id = await newSchool(-1);
    const stale = await load(id); // what runDaily loaded: the trial looks over
    await trial.extend(id, { days: 10, reason: 'sales' }, { userId: null }, now);

    await (trial as unknown as { expire: (s: School, n: Date) => Promise<void> }).expire(
      stale,
      now,
    );

    expect((await load(id)).status).toBe(SchoolStatus.ACTIVE);
    expect(notices.notifyAdmins).not.toHaveBeenCalledWith(id, 'trial_ended');
  });

  it('warning date is the school-local day: a 20:00Z end is the next day in Dhaka', async () => {
    const id = await newSchool(null);
    await ds.getRepository(School).update(id, { trial_ends_at: new Date('2026-10-06T20:00:00Z') });
    await trial.runDaily(now); // ~5.8 days out: d7 window
    expect(notices.notifyAdmins).toHaveBeenCalledWith(id, 'trial_warning_d7', {
      date: '2026-10-07',
    });
  });

  it('warn keeps other onboarding keys; extend to unlimited is audited as null', async () => {
    const id = await newSchool(6);
    await ds.getRepository(School).update(id, { onboarding: { step: 'profile' }, seat_limit: 10 });
    await trial.runDaily(now);
    expect((await load(id)).onboarding).toEqual({ step: 'profile', trial_warnings: ['d7'] });

    await trial.extend(id, { days: 1, seat_limit: null, reason: 'x' }, { userId: null }, now);
    const [row] = await ds.query(
      `SELECT new_values FROM audit_logs WHERE entity_type = 'Trial' AND entity_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [id],
    );
    expect(row.new_values.seat_limit).toBeNull();
    expect((await load(id)).onboarding).toEqual({ step: 'profile', trial_warnings: [] });
  });
});
