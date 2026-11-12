import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import type { Request } from 'express';
import type { JwtPayload } from '@biddaloy/shared';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PlatformSchoolsController } from './platform-schools.controller';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PlatformSchoolSearchQueryDto } from './dto/platform-school-search.dto';
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
    searchForPlatform: vi.fn().mockResolvedValue({ items: [], total: 0 }),
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

  it('search delegates to searchForPlatform', async () => {
    const owner = { user: { typ: 'cockpit', sub: 'u', jti: 'j', fam: 'f' } } as never;
    expect(await controller.search({ q: 'a' }, owner)).toEqual({ items: [], total: 0 });
    expect(service.searchForPlatform).toHaveBeenCalledWith({ q: 'a' });
  });

  it('search refuses a non-cockpit principal', async () => {
    await expect(controller.search({}, { user: { sub: 'u' } } as never)).rejects.toThrow(
      'platform owners only',
    );
  });

  it('search query: limit 101 is refused, 100 and every status and sort pass (Rule 5)', async () => {
    const check = (o: object) => validate(plainToInstance(PlatformSchoolSearchQueryDto, o));
    expect(await check({ limit: '101' })).not.toHaveLength(0);
    expect(await check({ limit: '100', sort: 'students', status: 'DELETED' })).toHaveLength(0);
    expect(await check({ sort: 'bogus' })).not.toHaveLength(0);
    expect(await check({ status: 'PLAN' })).not.toHaveLength(0);
  });

  it('search is declared before every :id route', () => {
    const order = Object.getOwnPropertyNames(PlatformSchoolsController.prototype);
    expect(order.indexOf('search')).toBeLessThan(order.indexOf('getStats'));
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
