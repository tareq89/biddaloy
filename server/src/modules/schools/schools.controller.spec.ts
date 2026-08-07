import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import type { Request } from 'express';
import type { JwtPayload } from '@beton-boi/shared';
import { SchoolsController } from './schools.controller';
import { SchoolsService } from './schools.service';
import { TenantSettingsDto } from './dto/tenant-settings.dto';

const SCHOOL_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL_B = 'bbbbbbbb-0000-4000-8000-000000000002';

const USER = { sub: 'user-1', jti: 'jti-1', memberships: [] } as unknown as JwtPayload;
const REQUEST = { ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } } as unknown as Request;

function fakeService() {
  return {
    getMaskedSettings: vi.fn(),
    updateSettings: vi.fn(),
  };
}

describe('SchoolsController', () => {
  let service: ReturnType<typeof fakeService>;
  let controller: SchoolsController;

  beforeEach(() => {
    service = fakeService();
    controller = new SchoolsController(service as unknown as SchoolsService);
  });

  describe('getSettings', () => {
    it('delegates to the service when an ADMIN reads their own school', async () => {
      service.getMaskedSettings.mockResolvedValue({ version: 1 });

      const result = await controller.getSettings(SCHOOL_A, { id: SCHOOL_A, role: 'ADMIN' });

      expect(service.getMaskedSettings).toHaveBeenCalledWith(SCHOOL_A);
      expect(result).toEqual({ version: 1 });
    });

    it('delegates to the service when a SUPER_ADMIN reads a school outside their own tenant', async () => {
      service.getMaskedSettings.mockResolvedValue({ version: 1 });

      await controller.getSettings(SCHOOL_A, { id: SCHOOL_B, role: 'SUPER_ADMIN' });

      expect(service.getMaskedSettings).toHaveBeenCalledWith(SCHOOL_A);
    });

    it('rejects an ADMIN reading a different school, without calling the service at all', async () => {
      await expect(
        controller.getSettings(SCHOOL_A, { id: SCHOOL_B, role: 'ADMIN' }),
      ).rejects.toThrow(ForbiddenException);
      expect(service.getMaskedSettings).not.toHaveBeenCalled();
    });
  });

  describe('updateSettings', () => {
    function patch(): TenantSettingsDto {
      return plainToInstance(TenantSettingsDto, { version: 1 });
    }

    it('updates then returns the freshly masked settings when an ADMIN writes their own school', async () => {
      service.updateSettings.mockResolvedValue({ version: 1 });
      service.getMaskedSettings.mockResolvedValue({ version: 1, masked: true });

      const result = await controller.updateSettings(
        SCHOOL_A,
        patch(),
        { id: SCHOOL_A, role: 'ADMIN' },
        USER,
        REQUEST,
      );

      expect(service.updateSettings).toHaveBeenCalledWith(
        SCHOOL_A,
        expect.any(TenantSettingsDto),
        'user-1',
        { ip: '127.0.0.1', userAgent: 'vitest' },
      );
      expect(service.getMaskedSettings).toHaveBeenCalledWith(SCHOOL_A);
      expect(result).toEqual({ version: 1, masked: true });
    });

    it('delegates for a SUPER_ADMIN writing a school outside their own tenant', async () => {
      service.updateSettings.mockResolvedValue({ version: 1 });
      service.getMaskedSettings.mockResolvedValue({ version: 1 });

      await controller.updateSettings(
        SCHOOL_A,
        patch(),
        { id: SCHOOL_B, role: 'SUPER_ADMIN' },
        USER,
        REQUEST,
      );

      expect(service.updateSettings).toHaveBeenCalledWith(
        SCHOOL_A,
        expect.any(TenantSettingsDto),
        'user-1',
        { ip: '127.0.0.1', userAgent: 'vitest' },
      );
    });

    it('rejects an ADMIN writing a different school, without touching the service', async () => {
      await expect(
        controller.updateSettings(
          SCHOOL_A,
          patch(),
          { id: SCHOOL_B, role: 'ADMIN' },
          USER,
          REQUEST,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(service.updateSettings).not.toHaveBeenCalled();
      expect(service.getMaskedSettings).not.toHaveBeenCalled();
    });
  });
});
