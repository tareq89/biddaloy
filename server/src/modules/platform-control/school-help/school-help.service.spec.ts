import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SchoolHelpService } from './school-help.service';

const ctx = { ip: null, userAgent: null };

function build(member: unknown, schoolExists = true) {
  const recovery = {
    adminReset: vi.fn().mockResolvedValue({ channel: 'EMAIL', expires_at: new Date() }),
  };
  const audit = { recordApproved: vi.fn() };
  const sessions = { revokeAllForSchool: vi.fn() };
  const svc = new SchoolHelpService(
    { findOne: async () => member } as never,
    { findOne: async () => ({ id: 'u' }), manager: {} } as never,
    { exist: async () => schoolExists } as never,
    recovery as never,
    {} as never,
    {} as never,
    sessions as never,
    audit as never,
  );
  return { svc, recovery, audit, sessions };
}

describe('SchoolHelpService', () => {
  it('a target that is not an ADMIN member of the school is 404 and nothing is sent or audited', async () => {
    const { svc, recovery, audit } = build(null);
    await expect(svc.sendAdminResetLink('s', 'u', 'a', ctx)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(recovery.adminReset).not.toHaveBeenCalled();
    expect(audit.recordApproved).not.toHaveBeenCalled();
  });

  it('a send writes PLATFORM_ADMIN_RESET_SENT with the school tenant id', async () => {
    const { svc, audit } = build({ id: 'm' });
    await svc.sendAdminResetLink('s', 'u', 'a', ctx);
    expect(audit.recordApproved).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PLATFORM_ADMIN_RESET_SENT', tenant_id: 's' }),
    );
  });

  it('logout-all on an unknown school is 404 and ends no session', async () => {
    const { svc, sessions } = build(null, false);
    await expect(svc.logoutAll('s', 'a', ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(sessions.revokeAllForSchool).not.toHaveBeenCalled();
  });
});
