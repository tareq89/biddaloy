import { describe, expect, it } from 'vitest';
import type { School } from '../modules/schools/entities/school.entity';
import {
  ensureArrivalNoticeSetting,
  ensureArrivalSeed,
  type ArrivalSeedRepositories,
} from './seed.arrival';

const TENANT = 'school-1';

const find =
  (rows: Record<string, unknown>[]) =>
  ({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve(rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null);

function setup(withDemoRows = true) {
  const subs: Record<string, unknown>[] = [];
  const students = withDemoRows
    ? [{ id: 's1', tenant_id: TENANT, registration_number: '2026-2027-0001' }]
    : [];
  const guardians = withDemoRows
    ? [{ id: 'g1', tenant_id: TENANT, email: 'guardian1@biddaloy.test' }]
    : [];
  const repos = {
    studentRepository: { findOne: find(students) },
    guardianRepository: { findOne: find(guardians) },
    arrivalSubscriptionRepository: {
      findOne: find(subs),
      create: (d: Record<string, unknown>) => ({ ...d }),
      save: (e: Record<string, unknown>) => {
        subs.push(e);
        return Promise.resolve(e);
      },
    },
  } as unknown as ArrivalSeedRepositories;
  return { subs, repos };
}

describe('ensureArrivalSeed [84.4.4]', () => {
  it('inserts exactly one ACTIVE RECURRING PUSH row, and a second run adds nothing', async () => {
    const { subs, repos } = setup();
    await ensureArrivalSeed(repos, TENANT);
    await ensureArrivalSeed(repos, TENANT);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      tenant_id: TENANT,
      student_id: 's1',
      guardian_id: 'g1',
      status: 'ACTIVE',
      mode: 'RECURRING',
      channel: 'PUSH',
    });
  });

  it('skips when the demo student or guardian is missing', async () => {
    const { subs, repos } = setup(false);
    await ensureArrivalSeed(repos, TENANT);
    expect(subs).toHaveLength(0);
  });
});

describe('ensureArrivalNoticeSetting [84.4.4]', () => {
  it('turns arrival notices on, app only, when the school never set them', () => {
    const school = {
      settings: { attendance: { periodAttendance: { enabled: true } } },
    } as unknown as School;
    expect(ensureArrivalNoticeSetting(school)).toBe(true);
    expect(school.settings?.attendance).toEqual({
      periodAttendance: { enabled: true },
      arrivalNotice: { enabled: true, smsAllowed: false },
    });
  });

  it('keeps a hand-set value on a re-run', () => {
    const school = {
      settings: { attendance: { arrivalNotice: { enabled: false, smsAllowed: false } } },
    } as unknown as School;
    expect(ensureArrivalNoticeSetting(school)).toBe(false);
    expect(school.settings?.attendance?.arrivalNotice).toEqual({
      enabled: false,
      smsAllowed: false,
    });
  });
});
