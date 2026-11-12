import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AuditAction, ImpersonationEntryKind, SupportAccessMode, UserRole } from '@biddaloy/shared';
import { ConsentGateService, type GateRequest } from './consent-gate.service';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const TICKET = '33333333-3333-4333-8333-333333333333';
const input = {
  schoolId: SCHOOL,
  targetUserId: TARGET,
  role: UserRole.ADMIN,
  reason: 'Parent reported a fee problem',
  viewOnly: false,
};
const req = {
  user: { sub: 'owner-1' },
  method: 'POST',
  originalUrl: '/platform/impersonation',
  headers: {},
  body: input,
} as GateRequest;

describe('ConsentGateService', () => {
  const query = vi.fn();
  const create = vi.fn();
  const activate = vi.fn();
  const supportAccessFresh = vi.fn();
  const enforce = vi.fn();
  const activeOwnerIds = vi.fn();
  const record = vi.fn();
  const notices = {
    sessionStarted: vi.fn(),
    emergency: vi.fn(),
    requestToAdmins: vi.fn(),
    ownersSessionStarted: vi.fn(),
  };
  let svc: ConsentGateService;

  const mode = (m: SupportAccessMode) => supportAccessFresh.mockResolvedValue({ mode: m });
  // A query that answers the name lookups and nothing else; tests queue extra answers first.
  const names = () => [{ name: 'Owner', school: 'School A' }];

  beforeEach(() => {
    vi.clearAllMocks();
    query.mockImplementation(async (sql: string) =>
      sql.includes('FROM users u, schools') ? names() : [],
    );
    create.mockResolvedValue({
      id: 'sid',
      platform_admin_id: 'owner-1',
      tenant_id: SCHOOL,
      status: 'ACTIVE',
    });
    activeOwnerIds.mockResolvedValue([]);
    svc = new ConsentGateService(
      { query } as never,
      { create, activate } as never,
      { supportAccessFresh } as never,
      notices as never,
      { enforce } as never,
      { activeOwnerIds } as never,
      { record } as never,
    );
  });

  describe('modes', () => {
    it('allowed: NORMAL entry, admins emailed, owners told, no two-person gate', async () => {
      mode(SupportAccessMode.ALLOWED);
      await svc.start(req, input);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ entryKind: ImpersonationEntryKind.NORMAL, viewOnly: false }),
      );
      expect(enforce).not.toHaveBeenCalled();
      expect(notices.sessionStarted).toHaveBeenCalledWith(SCHOOL, expect.anything());
      expect(notices.ownersSessionStarted).toHaveBeenCalled();
    });

    it('ask: request sent to admins with the session id, never a started notice', async () => {
      mode(SupportAccessMode.ASK);
      create.mockResolvedValue({ id: 'sid', platform_admin_id: 'owner-1', tenant_id: SCHOOL });
      await svc.start(req, input);
      expect(notices.requestToAdmins).toHaveBeenCalledWith(SCHOOL, 'sid', expect.anything());
      expect(notices.sessionStarted).not.toHaveBeenCalled();
      expect(enforce).not.toHaveBeenCalled();
    });

    it('blocked: gate runs BEFORE create, EMERGENCY + view-only, emergency notice sent', async () => {
      mode(SupportAccessMode.BLOCKED);
      const order: string[] = [];
      enforce.mockImplementation(async () => void order.push('enforce'));
      create.mockImplementation(async () => {
        order.push('create');
        return { id: 'sid', platform_admin_id: 'owner-1', tenant_id: SCHOOL };
      });
      await svc.start(req, input);
      expect(order).toEqual(['enforce', 'create']);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ entryKind: ImpersonationEntryKind.EMERGENCY, viewOnly: true }),
      );
      expect(notices.emergency).toHaveBeenCalledWith(SCHOOL, expect.anything());
    });

    it('blocked: a pending approval (enforce throws) creates nothing', async () => {
      mode(SupportAccessMode.BLOCKED);
      enforce.mockRejectedValue(
        new HttpException({ details: { code: 'APPROVAL_REQUESTED' } }, 403),
      );
      await expect(svc.start(req, input)).rejects.toMatchObject({ status: 403 });
      expect(create).not.toHaveBeenCalled();
    });

    it('reads only the body school setting (cross-tenant)', async () => {
      mode(SupportAccessMode.ALLOWED);
      await svc.start(req, input);
      expect(supportAccessFresh).toHaveBeenCalledTimes(1);
      expect(supportAccessFresh).toHaveBeenCalledWith(SCHOOL);
    });

    it('a failing notice never fails the start', async () => {
      mode(SupportAccessMode.ALLOWED);
      notices.sessionStarted.mockRejectedValue(new Error('smtp down'));
      await expect(svc.start(req, input)).resolves.toMatchObject({ id: 'sid' });
    });
  });

  describe('ticket redemption', () => {
    const withTicket = { ...input, ticketId: TICKET };

    it('a usable ticket is activated once and does not read the mode', async () => {
      query.mockResolvedValueOnce([{ '?column?': 1 }]);
      activate.mockResolvedValue({ id: TICKET, platform_admin_id: 'owner-1', tenant_id: SCHOOL });
      await svc.start(req, withTicket);
      expect(activate).toHaveBeenCalledWith(TICKET);
      expect(create).not.toHaveBeenCalled();
      // The pre-check binds owner, school, person and role: a wrong one finds no row.
      expect(query.mock.calls[0][1]).toEqual([TICKET, 'owner-1', SCHOOL, TARGET, 'ADMIN']);
    });

    it('wrong owner / school / person / role / expired (no row) is 409 TICKET_NOT_USABLE', async () => {
      query.mockResolvedValueOnce([]);
      const err = await svc.start(req, withTicket).catch((e) => e);
      expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(err.getResponse().details.code).toBe('TICKET_NOT_USABLE');
      expect(activate).not.toHaveBeenCalled();
    });

    it('used twice: the second activate loses the UPDATE and maps to the same 409', async () => {
      query.mockResolvedValueOnce([{}]);
      activate.mockRejectedValue(
        new HttpException({ code: 'SESSION_NOT_ACTIVATABLE', message: 'x' }, 409),
      );
      const err = await svc.start(req, withTicket).catch((e) => e);
      expect(err.getResponse().details.code).toBe('TICKET_NOT_USABLE');
    });

    it('other activate errors (blocked school) pass through unchanged', async () => {
      query.mockResolvedValueOnce([{}]);
      activate.mockRejectedValue(new HttpException({ code: 'SUPPORT_ACCESS_BLOCKED' }, 403));
      await expect(svc.start(req, withTicket)).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('requestWrite', () => {
    it('sets the marker, audits SUPPORT_ACCESS_REQUESTED kind WRITE, asks the admins', async () => {
      query.mockImplementation(async (sql: string) =>
        sql.startsWith('UPDATE')
          ? [{ tenant_id: SCHOOL, role: 'ADMIN' }]
          : sql.includes('FROM users u, schools')
            ? names()
            : [],
      );
      await svc.requestWrite('owner-1', 'sid', 'Need to fix the fee');
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.SUPPORT_ACCESS_REQUESTED,
          tenant_id: SCHOOL,
          new_values: { sessionId: 'sid', kind: 'WRITE' },
        }),
      );
      expect(notices.requestToAdmins).toHaveBeenCalledWith(SCHOOL, 'sid', expect.anything());
    });

    it('not this owner session (or unknown) is 404; own session not eligible is 409; nothing audited', async () => {
      query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await expect(svc.requestWrite('owner-1', 'sid', 'reason here ok')).rejects.toMatchObject({
        status: 404,
      });
      query.mockResolvedValueOnce([]).mockResolvedValueOnce([{}]);
      await expect(svc.requestWrite('owner-1', 'sid', 'reason here ok')).rejects.toMatchObject({
        status: 409,
      });
      expect(record).not.toHaveBeenCalled();
      expect(notices.requestToAdmins).not.toHaveBeenCalled();
    });

    it('the UPDATE is guarded on owner, EMERGENCY, locked, no open request, not expired', async () => {
      query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await svc.requestWrite('owner-1', 'sid', 'reason here ok').catch(() => undefined);
      const sql: string = query.mock.calls[0][0];
      for (const frag of [
        'platform_admin_id = $2',
        "entry_kind = 'EMERGENCY'",
        'write_locked',
        'write_requested_at IS NULL',
        'expires_at > now()',
      ]) {
        expect(sql).toContain(frag);
      }
    });
  });
});
