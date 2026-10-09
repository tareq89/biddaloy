import { describe, expect, it, vi } from 'vitest';
import { ApplicationType } from '@biddaloy/shared';
import { todayInSchoolTz } from '../common/time';
import {
  ensureApplicationsSeed,
  type ApplicationsSeedPorts,
  type ApplicationsSeedRepositories,
} from './seed.applications';

const TENANT = 'school-1';
const ADMIN = 'admin-1';

/** Minimal in-memory repos; `count` reads how many applications the fake ports "filed". */
function setup(existing = 0) {
  const filed: { caller: { userId: string; role: string }; dto: Record<string, unknown> }[] = [];
  const ports = {
    submit: vi.fn((_t, caller, dto) => {
      filed.push({ caller, dto });
      return Promise.resolve({ id: `app-${filed.length}` });
    }),
    comment: vi.fn(() => Promise.resolve()),
    addTags: vi.fn(() => Promise.resolve()),
  };
  const one = (row: unknown) => ({ findOne: () => Promise.resolve(row) });
  const repos = {
    applicationRepository: {
      count: () => Promise.resolve(existing + filed.length),
      // The row-writing seeds find nothing here and stop at their own guards.
      manager: { query: () => Promise.resolve([]) },
    },
    // Only the teacher's profile is reachable by user id; the admin's profile must not be picked.
    staffProfileRepository: {
      findOne: ({ where }: { where: { user_id: string } }) =>
        Promise.resolve(
          where.user_id === 'teacher-user' ? { id: 'sp-1', user_id: 'teacher-user' } : null,
        ),
    },
    guardianRepository: one({
      user_id: 'parent-user',
      students: [{ id: 'stu-1', class_section_id: 'sec-1' }],
    }),
    userRepository: {
      findOne: ({ where }: { where: { email: string } }) =>
        Promise.resolve(
          where.email === 'teacher@biddaloy.test' ? { id: 'teacher-user' } : { id: 'office-user' },
        ),
    },
    userTenantRepository: {
      findOne: ({ where }: { where: { user_id: string } }) =>
        Promise.resolve({ role: where.user_id === 'teacher-user' ? 'TEACHER' : 'ADMIN' }),
    },
    classSectionRepository: {
      find: () => Promise.resolve([{ id: 'sec-1' }, { id: 'sec-2' }]),
    },
    examRepository: one({ id: 'exam-1' }),
    subjectRepository: one({ id: 'sub-1' }),
  };
  return {
    filed,
    ports,
    repos: repos as unknown as ApplicationsSeedRepositories,
    asPorts: ports as unknown as ApplicationsSeedPorts,
  };
}

describe('ensureApplicationsSeed', () => {
  it('files one of each type but READMISSION plus two PAPER entries, tags and a comment, all through the ports', async () => {
    const { filed, ports, repos, asPorts } = setup();
    await ensureApplicationsSeed(repos, asPorts, TENANT, ADMIN);

    expect(filed).toHaveLength(11);
    const types = new Set(filed.map((f) => f.dto.type));
    // Every demo student is ACTIVE, and submit refuses a READMISSION for an active student.
    expect([...types].sort()).toEqual(
      Object.values(ApplicationType)
        .filter((t) => t !== ApplicationType.READMISSION)
        .sort(),
    );
    const tc = filed.find((f) => f.dto.type === ApplicationType.TRANSFER_CERTIFICATE)!;
    // A future leaving date could not be approved (DATE_IN_FUTURE) on the demo.
    const leaving = (tc.dto.payload as { leaving_date: string }).leaving_date;
    expect(leaving <= todayInSchoolTz()).toBe(true);
    // The two paper entries come from the office user.
    const paper = filed.filter((f) => f.dto.on_behalf_of_user_id || f.dto.applicant_name);
    expect(paper.map((f) => f.caller.userId)).toEqual(['office-user', 'office-user']);
    expect(ports.addTags).toHaveBeenCalledTimes(2);
    expect(ports.comment).toHaveBeenCalledTimes(1);
  });

  it('keeps the pending staff leave at 24-25 March, clear of the approved 10-11 March leave', async () => {
    const { filed, repos, asPorts } = setup();
    await ensureApplicationsSeed(repos, asPorts, TENANT, ADMIN);
    const staffLeave = filed.find((f) => f.dto.type === ApplicationType.STAFF_LEAVE)!;
    expect(staffLeave.caller).toEqual({ userId: 'teacher-user', role: 'TEACHER' });
    expect(staffLeave.dto.payload).toMatchObject({
      start_date: '2026-03-24',
      end_date: '2026-03-25',
    });
  });

  it('does nothing when the tenant already has applications', async () => {
    const { ports, repos, asPorts } = setup(3);
    await ensureApplicationsSeed(repos, asPorts, TENANT, ADMIN);
    expect(ports.submit).not.toHaveBeenCalled();
  });
});
