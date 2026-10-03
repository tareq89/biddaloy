import { describe, it, expect, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Permission, UserRole } from '@biddaloy/shared';
import { PrintHistoryService } from './print-history.service';
import { PrintJobsService } from './print-jobs.service';
import { PrintHistoryController, PrintJobActionsController } from './print-history.controller';

const caller = (role = 'ADMIN') => ({ tenantId: 't1', userId: 'u1', role });
const meta = (key: string, target: object, prop?: string) =>
  Reflect.getMetadata(key, prop ? (target as any)[prop] : target);

function makeHistory() {
  const query = vi.fn(async (sql: string) => (sql.includes('count(*)') ? [{ n: 0 }] : []));
  const svc = new PrintHistoryService({ query } as any, { record: vi.fn() } as any);
  return { svc, query };
}

describe('PrintHistoryService.list', () => {
  it('never selects the data snapshot in a list', async () => {
    const { svc, query } = makeHistory();
    await svc.list(caller(), {} as any);
    for (const [sql] of query.mock.calls as unknown as string[][]) {
      expect(sql).not.toContain('data_snapshot');
    }
  });

  it('every filter becomes a bound parameter, never part of the SQL text', async () => {
    const { svc, query } = makeHistory();
    await svc.list(caller(), {
      document_kind: 'STAFF_ID_CARD',
      template_id: 'zz-tpl-1',
      subject_type: 'STAFF',
      subject_id: 'zz-sub-1',
      printed_by: 'zz-usr-1',
      from: '2027-01-01',
      to: '2027-01-31',
      status: 'CONFIRMED',
      outcome: 'FAILED',
      revoked: true,
      q: "x'; DROP TABLE users;--",
    } as any);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    for (const v of ['STAFF_ID_CARD', 'zz-tpl-1', 'zz-sub-1', 'zz-usr-1', 'CONFIRMED', 'FAILED']) {
      expect(params).toContain(v);
      expect(sql).not.toContain(v);
    }
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).toContain('i.revoked_at IS NOT NULL');
    expect(sql).toContain('i.tenant_id = $1'); // always scoped to the caller's tenant
    expect(params[0]).toBe('t1');
  });

  it('pages the result', async () => {
    const { svc } = makeHistory();
    const res = await svc.list(caller(), { page: 3, limit: 10 } as any);
    expect(res).toMatchObject({ page: 3, limit: 10, total: 0, totalPages: 0 });
  });
});

describe('PrintHistoryService.getItem', () => {
  it('hides a staff item from a role without STAFF_HR_READ (D18)', async () => {
    const query = vi.fn(async () => [{ subject_type: 'STAFF' }]);
    const svc = new PrintHistoryService({ query } as any, { record: vi.fn() } as any);
    await expect(svc.getItem(caller('EXECUTIVE'), 'i1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('PrintHistoryService.subjectHistory', () => {
  it('lists a student for anyone allowed to print', async () => {
    const { svc } = makeHistory();
    await expect(svc.subjectHistory(caller('ACCOUNTANT'), 'STUDENT', 's1')).resolves.toEqual([]);
  });

  it('refuses a staff subject to a role without STAFF_HR_READ (D18)', async () => {
    const { svc } = makeHistory();
    await expect(svc.subjectHistory(caller('PARENT'), 'STAFF', 's1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('PrintHistoryService.revoke', () => {
  const withUpdate = (affected: number, exists: number) => {
    const manager = {
      // The visibility pre-check (ACR gate) finds the row unless the test says it is missing.
      query: vi.fn(async () => (exists || affected ? [{ '?column?': 1 }] : [])),
      update: vi.fn(async () => ({ affected })),
      count: vi.fn(async () => exists),
    };
    const audit = { record: vi.fn() };
    const svc = new PrintHistoryService(
      { transaction: (fn: any) => fn(manager) } as any,
      audit as any,
    );
    return { svc, audit };
  };

  it('revokes once and audits it', async () => {
    const { svc, audit } = withUpdate(1, 1);
    await svc.revoke(caller(), 'i1', 'Lost card');
    expect(audit.record).toHaveBeenCalledOnce();
  });

  it('a second revoke is a 409', async () => {
    const { svc } = withUpdate(0, 1);
    await expect(svc.revoke(caller(), 'i1', 'again')).rejects.toBeInstanceOf(ConflictException);
  });

  it('an item that is not in this tenant is a 404', async () => {
    const { svc } = withUpdate(0, 0);
    await expect(svc.revoke(caller(), 'i1', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PrintJobsService.confirm / reprint access', () => {
  const job = {
    id: 'j1',
    tenant_id: 't1',
    printed_by: 'someone-else',
    document_kind: 'STUDENT_ID_CARD',
    status: 'OPEN',
  };
  const svcWith = (found: unknown) => {
    const manager = { findOne: vi.fn(async () => found) };
    return new PrintJobsService(
      { transaction: (fn: any) => fn(manager) } as any,
      {} as any,
      {} as any,
    );
  };

  it("a different non-admin user can't close out someone else's job", async () => {
    await expect(svcWith(job).confirm(caller('ACCOUNTANT'), 'j1', [])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('an unknown job is a 404 for confirm and for reprint', async () => {
    await expect(svcWith(null).confirm(caller(), 'j1', [])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svcWith(null).reprint(caller(), 'j1', ['i1'])).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('print history route roles (guards)', () => {
  it('reading the print history is ADMIN + EXECUTIVE only, so ACCOUNTANT is denied', () => {
    for (const route of ['list', 'item']) {
      const roles = meta('roles', PrintHistoryController.prototype, route);
      expect(roles).toEqual([UserRole.ADMIN, UserRole.EXECUTIVE]);
      expect(roles).not.toContain(UserRole.ACCOUNTANT);
      expect(meta('permissions', PrintHistoryController.prototype, route)).toContain(
        Permission.PRINT_HISTORY_READ,
      );
    }
  });

  it('only ADMIN can revoke, behind DOCUMENT_REVOKE', () => {
    expect(meta('roles', PrintHistoryController.prototype, 'revoke')).toEqual([UserRole.ADMIN]);
    expect(meta('permissions', PrintHistoryController.prototype, 'revoke')).toContain(
      Permission.DOCUMENT_REVOKE,
    );
  });

  it('subject-history, confirm and reprint are open to ACCOUNTANT via DOCUMENT_PRINT', () => {
    expect(meta('roles', PrintJobActionsController)).toEqual([UserRole.ADMIN, UserRole.ACCOUNTANT]);
    expect(meta('permissions', PrintJobActionsController)).toContain(Permission.DOCUMENT_PRINT);
  });
});
