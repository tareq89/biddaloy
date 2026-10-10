import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApplicationEventKind, ApplicationType, UserRole, UserStatus } from '@biddaloy/shared';
import { ApplicationNotifyService } from './application-notify.service';
import { ApplicationTag } from './entities/application-tag.entity';
import { Student } from '../students/entities/student.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';

const TENANT = 'tenant-a';
const APP_ID = 'app-1';

const app = (over: Record<string, unknown> = {}) =>
  ({
    id: APP_ID,
    tenant_id: TENANT,
    type: ApplicationType.STUDENT_LEAVE,
    serial_year: 2026,
    serial_no: 45,
    applicant_user_id: 'applicant',
    entered_by_user_id: null,
    applicant_name: 'Tanvir',
    subject_student_id: 'stu-1',
    subject_staff_profile_id: null,
    ...over,
  }) as any;

const member = (user_id: string, role: string, status = UserStatus.ACTIVE) => ({
  user_id,
  role,
  user: { status },
});
const guardian = (id: string, user_id: string | null, phone: string | null = '+8801700000000') => ({
  id,
  user_id,
  phone,
  full_name: id,
  notifications_enabled: true,
  is_primary_contact: false,
});

describe('ApplicationNotifyService', () => {
  let push: { sendToUser: ReturnType<typeof vi.fn> };
  let communications: { enqueue: ReturnType<typeof vi.fn> };
  let smsCredit: { isMetered: ReturnType<typeof vi.fn>; reserve: ReturnType<typeof vi.fn> };
  let settings: Record<string, unknown>;
  let reviewerScope: { currentDeciderUserIds: ReturnType<typeof vi.fn> };
  let memberships: ReturnType<typeof member>[];
  let tags: unknown[];
  let student: any;
  let applicantMembership: any;
  let membershipWhere: any;
  let service: ApplicationNotifyService;

  beforeEach(() => {
    push = { sendToUser: vi.fn().mockResolvedValue({}) };
    communications = { enqueue: vi.fn().mockResolvedValue({}) };
    smsCredit = {
      isMetered: vi.fn().mockResolvedValue(false),
      reserve: vi.fn().mockResolvedValue({ ok: true }),
    };
    settings = { region: { locale: 'en-US' } };
    reviewerScope = { currentDeciderUserIds: vi.fn().mockResolvedValue([]) };
    memberships = [];
    tags = [];
    applicantMembership = null;
    student = {
      id: 'stu-1',
      user_id: 'student-user',
      full_name: 'Tanvir Hasan',
      full_name_bn: null,
      guardians: [guardian('g1', 'guardian-1'), guardian('g2', 'guardian-2')],
    };
    const manager = {
      find: vi.fn(async (entity: unknown, opts: any) => {
        if (entity === ApplicationTag) return tags;
        if (entity === UserTenant) {
          membershipWhere = opts.where;
          return memberships;
        }
        return [];
      }),
      findOne: vi.fn(async (entity: unknown) => {
        if (entity === Student) return student;
        if (entity === UserTenant) return applicantMembership;
        return null;
      }),
    };
    service = new ApplicationNotifyService(
      push as any,
      communications as any,
      smsCredit as any,
      { findById: async () => ({ id: TENANT, name: 'Biddaloy', settings }) } as any,
      reviewerScope as any,
      { manager } as any,
    );
  });

  const pushedIds = () => push.sendToUser.mock.calls.map((c) => c[0]).sort();

  it('onSubmitted pushes each current decider once, never the submitter', async () => {
    reviewerScope.currentDeciderUserIds.mockResolvedValue(['teacher', 'applicant']);
    memberships = [member('teacher', UserRole.TEACHER), member('applicant', UserRole.PARENT)];
    await service.onSubmitted(app());
    expect(pushedIds()).toEqual(['teacher']);
    expect(push.sendToUser.mock.calls[0][2]).toMatchObject({ type: 'applications.pending' });
  });

  it('onStatusChanged(APPROVED) pushes applicant, student user and linked guardians; skips inactive and login-less ones', async () => {
    student.guardians = [
      guardian('g1', 'guardian-1'),
      guardian('g2', 'guardian-2'),
      guardian('g3', null), // no login
      guardian('g4', 'guardian-4'), // inactive, filtered by membership status
    ];
    memberships = [
      member('applicant', UserRole.PARENT),
      member('student-user', UserRole.STUDENT),
      member('guardian-1', UserRole.PARENT),
      member('guardian-2', UserRole.PARENT),
      member('guardian-4', UserRole.PARENT, UserStatus.INACTIVE),
    ];
    await service.onStatusChanged(app(), {
      id: 'ev-1',
      kind: ApplicationEventKind.APPROVED,
      actor_user_id: 'headmaster',
    } as any);
    expect(pushedIds()).toEqual(['applicant', 'guardian-1', 'guardian-2', 'student-user']);
    // Guardians and students get the portal url
    expect(push.sendToUser.mock.calls[0][2].url).toBe(`/portal/applications/${APP_ID}`);
  });

  it('a paper application (no applicant user) still pushes the guardians and does not throw', async () => {
    memberships = [member('guardian-1', UserRole.PARENT)];
    await expect(
      service.onStatusChanged(app({ applicant_user_id: null }), {
        id: 'ev-1',
        kind: ApplicationEventKind.REJECTED,
        actor_user_id: 'headmaster',
      } as any),
    ).resolves.toBeUndefined();
    expect(pushedIds()).toEqual(['guardian-1']);
  });

  const bodyOf = () => push.sendToUser.mock.calls[0][2].body as string;
  const decide = (over: Record<string, unknown>) => {
    reviewerScope.currentDeciderUserIds.mockResolvedValue(['teacher']);
    memberships = [member('teacher', UserRole.TEACHER)];
    return service.onStepAdvanced(app(over));
  };

  it('push body names the subject student when there is one', async () => {
    await decide({});
    expect(bodyOf()).toBe('Student leave · 2026/0045 · Tanvir Hasan');
  });

  it('portal application (applicant_name null, no student) falls back to the applicant account name', async () => {
    applicantMembership = { user: { full_name: 'Rina Begum' } };
    await decide({ subject_student_id: null, applicant_name: null });
    expect(bodyOf()).toBe('Student leave · 2026/0045 · Rina Begum');
  });

  it('paper application (no applicant user) uses applicant_name', async () => {
    await decide({ subject_student_id: null, applicant_user_id: null, applicant_name: 'Karim' });
    expect(bodyOf()).toBe('Student leave · 2026/0045 · Karim');
  });

  it('staff get the non-portal url', async () => {
    reviewerScope.currentDeciderUserIds.mockResolvedValue(['teacher']);
    memberships = [member('teacher', UserRole.TEACHER)];
    await service.onSubmitted(app());
    expect(push.sendToUser.mock.calls[0][2].url).toBe(`/applications/${APP_ID}`);
  });

  it('onTagged by role queries only this tenant and pushes the members it returns', async () => {
    memberships = [member('office-1', UserRole.OFFICE_STAFF)];
    await service.onTagged(app(), [
      { user_id: null, role: UserRole.OFFICE_STAFF, created_by_user_id: 'tagger' } as any,
    ]);
    // Tenant isolation: the membership query is scoped to this tenant and the tagged role
    expect(membershipWhere).toEqual([
      expect.objectContaining({ tenant_id: TENANT, role: expect.anything() }),
    ]);
    expect(pushedIds()).toEqual(['office-1']);
  });

  it('onComment skips the comment author', async () => {
    tags = [
      { user_id: 'author', role: null },
      { user_id: 'tagged', role: null },
    ];
    memberships = [member('author', UserRole.TEACHER), member('tagged', UserRole.TEACHER)];
    await service.onComment(app(), { actor_user_id: 'author' } as any);
    expect(pushedIds()).toEqual(['tagged']);
  });

  it('one rejected push does not stop the others and the method resolves', async () => {
    reviewerScope.currentDeciderUserIds.mockResolvedValue(['a', 'b']);
    memberships = [member('a', UserRole.TEACHER), member('b', UserRole.TEACHER)];
    push.sendToUser.mockRejectedValueOnce(new Error('push down'));
    await expect(service.onStepAdvanced(app())).resolves.toBeUndefined();
    expect(push.sendToUser).toHaveBeenCalledTimes(2);
  });

  it('never throws even when recipient lookup fails', async () => {
    reviewerScope.currentDeciderUserIds.mockRejectedValue(new Error('db down'));
    await expect(service.onSubmitted(app())).resolves.toBeUndefined();
  });

  describe('decision SMS', () => {
    const on = () => {
      settings = {
        region: { locale: 'en-US' },
        applications: { smsOnDecision: true },
        communications: { sms: { provider: 'test' } },
      };
    };
    const ev = (kind: ApplicationEventKind) =>
      ({ id: 'ev-1', kind, actor_user_id: 'headmaster' }) as any;

    it('is off by default: no enqueue', async () => {
      await service.onStatusChanged(app(), ev(ApplicationEventKind.APPROVED));
      expect(communications.enqueue).not.toHaveBeenCalled();
    });

    it('on + REJECTED enqueues one SMS per eligible guardian, with guardian and student ids', async () => {
      on();
      await service.onStatusChanged(app(), ev(ApplicationEventKind.REJECTED));
      expect(communications.enqueue).toHaveBeenCalledTimes(2);
      expect(communications.enqueue.mock.calls[0][0]).toMatchObject({
        guardian_id: 'g1',
        student_id: 'stu-1',
        message_body: 'Biddaloy: Application 2026/0045 for Tanvir Hasan was rejected.',
      });
    });

    it('skips a guardian with no phone', async () => {
      on();
      student.guardians = [guardian('g1', null, null), guardian('g2', null)];
      await service.onStatusChanged(app(), ev(ApplicationEventKind.APPROVED));
      expect(communications.enqueue).toHaveBeenCalledTimes(1);
    });

    it('is not sent for UNDER_CONSIDERATION or WITHDRAWN', async () => {
      on();
      await service.onStatusChanged(app(), ev(ApplicationEventKind.UNDER_CONSIDERATION));
      await service.onStatusChanged(app(), ev(ApplicationEventKind.WITHDRAWN));
      expect(communications.enqueue).not.toHaveBeenCalled();
    });

    it('is not sent for a staff subject', async () => {
      on();
      await service.onStatusChanged(
        app({ subject_student_id: null }),
        ev(ApplicationEventKind.APPROVED),
      );
      expect(communications.enqueue).not.toHaveBeenCalled();
    });

    it('a metered tenant reserves under batch:application:<id>:<event> and passes it to enqueue', async () => {
      on();
      smsCredit.isMetered.mockResolvedValue(true);
      await service.onStatusChanged(app(), ev(ApplicationEventKind.APPROVED));
      expect(smsCredit.reserve).toHaveBeenCalledWith(
        TENANT,
        2,
        `batch:application:${APP_ID}:ev-1`,
        { type: 'batch', id: 'ev-1' },
      );
      expect(communications.enqueue.mock.calls[0][3]).toEqual({
        batchId: `application:${APP_ID}:ev-1`,
        segments: 1,
      });
    });

    it('insufficient credit: no enqueue, push still sent', async () => {
      on();
      smsCredit.isMetered.mockResolvedValue(true);
      smsCredit.reserve.mockResolvedValue({ ok: false, available: 0 });
      memberships = [member('guardian-1', UserRole.PARENT)];
      await service.onStatusChanged(app(), ev(ApplicationEventKind.APPROVED));
      expect(communications.enqueue).not.toHaveBeenCalled();
      expect(pushedIds()).toEqual(['guardian-1']);
    });
  });
});
