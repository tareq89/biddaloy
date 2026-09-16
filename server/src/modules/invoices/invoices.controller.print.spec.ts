import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { FamilyAccessService } from '../students/family-access.service';
import { UserRole } from '@biddaloy/shared';

/**
 * [16.5.2] Unit coverage for `GET /invoices/:id/print`'s wiring — the
 * default format, and the family-caller linkage filter that fixes #664's
 * follow-up (a guardian linked to only one sibling on a shared invoice
 * must not see the other's data in printed output). Full HTML-content
 * behaviour is covered by `invoice-print.template.spec.ts` /
 * `invoice-print-pos.template.spec.ts`; DB-backed 404/tenant-isolation
 * cases are covered by `invoices.service.integration.spec.ts` and
 * `invoices.e2e-spec.ts`.
 */
describe('InvoicesController#print', () => {
  let controller: InvoicesController;
  let invoicesService: {
    findOne: ReturnType<typeof vi.fn>;
    getPrintableHtml: ReturnType<typeof vi.fn>;
  };
  let familyAccess: { assertLinkedToAny: ReturnType<typeof vi.fn> };

  const TENANT_ID = 'tenant-1';
  const USER_SUB = 'user-1';

  beforeEach(() => {
    invoicesService = {
      findOne: vi.fn(),
      getPrintableHtml: vi.fn().mockResolvedValue('<html></html>'),
    };
    familyAccess = { assertLinkedToAny: vi.fn() };
    controller = new InvoicesController(
      invoicesService as unknown as InvoicesService,
      familyAccess as unknown as FamilyAccessService,
    );
  });

  it('defaults format to a4 and skips the family check for staff', async () => {
    await controller.print(
      'invoice-1',
      { format: undefined },
      { id: TENANT_ID, role: UserRole.ADMIN },
      { sub: USER_SUB } as any,
    );

    expect(familyAccess.assertLinkedToAny).not.toHaveBeenCalled();
    expect(invoicesService.getPrintableHtml).toHaveBeenCalledWith(
      'invoice-1',
      TENANT_ID,
      'a4',
      undefined,
    );
  });

  it('passes the requested format straight through for staff', async () => {
    await controller.print(
      'invoice-1',
      { format: 'pos58' },
      { id: TENANT_ID, role: UserRole.ACCOUNTANT },
      { sub: USER_SUB } as any,
    );

    expect(invoicesService.getPrintableHtml).toHaveBeenCalledWith(
      'invoice-1',
      TENANT_ID,
      'pos58',
      undefined,
    );
  });

  it('for a family caller, checks linkage against every student on the invoice and forwards only the linked subset', async () => {
    invoicesService.findOne.mockResolvedValue({
      student_id: 'student-1',
      snapshot: { students: [{ id: 'student-1' }, { id: 'student-2' }] },
    });
    familyAccess.assertLinkedToAny.mockResolvedValue(['student-1']);

    await controller.print(
      'invoice-1',
      { format: 'a4' },
      { id: TENANT_ID, role: UserRole.PARENT },
      { sub: USER_SUB } as any,
    );

    expect(familyAccess.assertLinkedToAny).toHaveBeenCalledWith(
      UserRole.PARENT,
      USER_SUB,
      ['student-1', 'student-1', 'student-2'],
      TENANT_ID,
    );
    expect(invoicesService.getPrintableHtml).toHaveBeenCalledWith('invoice-1', TENANT_ID, 'a4', [
      'student-1',
    ]);
  });

  it('propagates the UnauthorizedException an unlinked family caller gets, without calling getPrintableHtml', async () => {
    invoicesService.findOne.mockResolvedValue({
      student_id: 'student-1',
      snapshot: { students: [{ id: 'student-1' }] },
    });
    const err = new Error('unauthorized');
    familyAccess.assertLinkedToAny.mockRejectedValue(err);

    await expect(
      controller.print('invoice-1', { format: 'a4' }, { id: TENANT_ID, role: UserRole.STUDENT }, {
        sub: USER_SUB,
      } as any),
    ).rejects.toThrow('unauthorized');
    expect(invoicesService.getPrintableHtml).not.toHaveBeenCalled();
  });
});
