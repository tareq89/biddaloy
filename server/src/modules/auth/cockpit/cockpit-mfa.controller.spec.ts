import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ApprovalScope } from '@biddaloy/shared';
import { CockpitMfaController } from './cockpit-mfa.controller';
import { REQUIRE_APPROVAL_KEY } from '../decorators/require-approval.decorator';

const req = (): any => ({
  ip: '1.1.1.1',
  headers: { 'user-agent': 'ua' },
  user: { sub: 'u1', jti: 'j', fam: 'f', typ: 'cockpit' },
});
const res = () => ({ setHeader: vi.fn() }) as any;

describe('CockpitMfaController', () => {
  const mfa: any = {
    status: vi.fn().mockResolvedValue({ enrolled: true, recoveryRemaining: 7 }),
    regenerateRecoveryCodes: vi.fn().mockResolvedValue(['a', 'b']),
  };
  const audit: any = { record: vi.fn().mockResolvedValue(undefined) };
  const controller = new CockpitMfaController(mfa, audit);

  it('is mounted at auth/cockpit', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CockpitMfaController)).toBe('auth/cockpit');
  });

  it('status reads the caller only and is no-store', async () => {
    const r = res();
    expect(await controller.status(req(), r)).toEqual({ enrolled: true, recoveryRemaining: 7 });
    expect(mfa.status).toHaveBeenCalledWith('u1');
    expect(r.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('regenerate needs the recovery-codes step-up scope', () => {
    expect(
      Reflect.getMetadata(REQUIRE_APPROVAL_KEY, CockpitMfaController.prototype.regenerate),
    ).toBe(ApprovalScope.PLATFORM_RECOVERY_CODES);
  });

  it('regenerate returns the codes and audits without them', async () => {
    const out = await controller.regenerate(req(), res());
    expect(out).toEqual({ recoveryCodes: ['a', 'b'] });
    expect(mfa.regenerateRecoveryCodes).toHaveBeenCalledWith('u1');
    const row = audit.record.mock.calls[0][0];
    expect(row.performed_by_user_id).toBe('u1');
    expect(JSON.stringify(row)).not.toContain('"a"');
  });
});
