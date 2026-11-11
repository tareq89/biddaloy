import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import type { Request } from 'express';
import type { JwtPayload } from '@biddaloy/shared';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PlatformSchoolsController } from './platform-schools.controller';
import { SchoolsService } from './schools.service';
import { PlatformAccessGuard } from '../platform-identity/platform-access.guard';
import { ProvisioningController } from './provisioning/provisioning.controller';
import { SchoolSmsCreditsController } from './sms-credits/sms-credits.controller';
import { SchoolAdminsController } from './admins/school-admins.controller';

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const USER = { sub: 'user-1' } as unknown as JwtPayload;
const REQUEST = { ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } } as unknown as Request;
const CTX = { ip: '127.0.0.1', userAgent: 'vitest' };

describe('PlatformSchoolsController', () => {
  const service = {
    findAll: vi.fn().mockResolvedValue(['a']),
    getStats: vi.fn().mockResolvedValue({ students: 1 }),
    updateStatus: vi.fn().mockResolvedValue({ id: ID }),
    revive: vi.fn().mockResolvedValue({ id: ID }),
  };
  const controller = new PlatformSchoolsController(service as unknown as SchoolsService);

  it('delegates list, stats, status and revive to the service', async () => {
    expect(await controller.findAll({})).toEqual(['a']);
    expect(service.findAll).toHaveBeenCalledWith(undefined);
    await controller.getStats(ID);
    expect(service.getStats).toHaveBeenCalledWith(ID);
    const status = { status: 'SUSPENDED', reason: 'Non-payment for 60 days' } as const;
    await controller.updateStatus(ID, status, USER, REQUEST);
    expect(service.updateStatus).toHaveBeenCalledWith(ID, status, 'user-1', CTX);
    await controller.revive(ID, { reason: 'Back' } as never, USER, REQUEST);
    expect(service.revive).toHaveBeenCalledWith(ID, { reason: 'Back' }, 'user-1', CTX);
  });

  function expectPlatformGated(cls: object, path: string) {
    expect(Reflect.getMetadata(PATH_METADATA, cls)).toBe(path);
    expect(Reflect.getMetadata(GUARDS_METADATA, cls)).toContain(PlatformAccessGuard);
  }

  it('PlatformSchoolsController lives under platform/ and is gated by PlatformAccessGuard', () => {
    expectPlatformGated(PlatformSchoolsController, 'platform/schools');
  });

  it('ProvisioningController lives under platform/ and is gated by PlatformAccessGuard', () => {
    expectPlatformGated(ProvisioningController, 'platform/schools');
  });

  it('SchoolSmsCreditsController lives under platform/ and is gated by PlatformAccessGuard', () => {
    expectPlatformGated(SchoolSmsCreditsController, 'platform/schools/:id/sms-credits');
  });

  it('SchoolAdminsController lives under platform/ and is gated by PlatformAccessGuard', () => {
    expectPlatformGated(SchoolAdminsController, 'platform/schools/:id/admins');
  });
});
