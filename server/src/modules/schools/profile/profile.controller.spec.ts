import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request } from 'express';
import type { JwtPayload } from '@biddaloy/shared';
import { SchoolProfileController } from './profile.controller';
import { SchoolProfileService } from './profile.service';
import { UpdateSchoolProfileDto } from './dto/update-school-profile.dto';

const SCHOOL_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const USER = { sub: 'user-1', jti: 'jti-1', memberships: [] } as unknown as JwtPayload;
const REQUEST = { ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } } as unknown as Request;

function fakeService() {
  return {
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
  };
}

describe('SchoolProfileController', () => {
  let service: ReturnType<typeof fakeService>;
  let controller: SchoolProfileController;

  beforeEach(() => {
    service = fakeService();
    controller = new SchoolProfileController(service as unknown as SchoolProfileService);
  });

  describe('getProfile', () => {
    it('always reads the caller own tenant, never a path param', async () => {
      service.getProfile.mockResolvedValue({ name: 'A School' });

      const result = await controller.getProfile({ id: SCHOOL_A, role: 'TEACHER' });

      expect(service.getProfile).toHaveBeenCalledWith(SCHOOL_A);
      expect(result).toEqual({ name: 'A School' });
    });
  });

  describe('updateProfile', () => {
    it('delegates the patch to the service with the caller tenant, user and request context', async () => {
      const dto = new UpdateSchoolProfileDto();
      dto.name = 'New Name';
      service.updateProfile.mockResolvedValue({ name: 'New Name' });

      const result = await controller.updateProfile(
        dto,
        { id: SCHOOL_A, role: 'ADMIN' },
        USER,
        REQUEST,
      );

      expect(service.updateProfile).toHaveBeenCalledWith(SCHOOL_A, dto, 'user-1', {
        ip: '127.0.0.1',
        userAgent: 'vitest',
      });
      expect(result).toEqual({ name: 'New Name' });
    });
  });
});
