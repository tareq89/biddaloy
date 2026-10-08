import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { UserStatus } from '@biddaloy/shared';
import { FirstPasswordService } from './first-password.service';

function build(affected: number) {
  const user = { id: 'u1', status: UserStatus.ACTIVE, password_hash: null, email: 'a@b.test' };
  const authService = {
    primaryTenantId: vi.fn().mockResolvedValue('t1'),
    resetLoginLockouts: vi.fn().mockResolvedValue(undefined),
  };
  const service = new FirstPasswordService(
    {
      findOne: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue({ affected }),
    } as never,
    { find: vi.fn().mockResolvedValue([{ role: 'PARENT' }]) } as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
    authService as never,
  );
  return { service, authService, user };
}

const context = { ip: '127.0.0.1', userAgent: 'vitest' };

describe('FirstPasswordService', () => {
  // Failed password tries against the password-less account may have locked
  // the login; the first password must work straight away.
  it('clears login lockouts once the first password is set', async () => {
    const { service, authService, user } = build(1);
    await service.set('u1', 'Strong-Pass-1', context);
    expect(authService.resetLoginLockouts).toHaveBeenCalledWith(user);
  });

  it('leaves lockouts alone when a racing request set the password first', async () => {
    const { service, authService } = build(0);
    await expect(service.set('u1', 'Strong-Pass-1', context)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(authService.resetLoginLockouts).not.toHaveBeenCalled();
  });
});
