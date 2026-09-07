import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from '@biddaloy/shared';
import { SchoolLogoController } from './logo.controller';
import { SchoolLogoService } from './logo.service';

const SCHOOL_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const USER = { sub: 'user-1', jti: 'jti-1', memberships: [] } as unknown as JwtPayload;
const REQUEST = { ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } } as unknown as Request;

function fakeService() {
  return { upload: vi.fn(), remove: vi.fn() };
}

describe('SchoolLogoController', () => {
  let service: ReturnType<typeof fakeService>;
  let controller: SchoolLogoController;

  beforeEach(() => {
    service = fakeService();
    controller = new SchoolLogoController(service as unknown as SchoolLogoService);
  });

  describe('upload', () => {
    it('delegates the file bytes to the service with the caller tenant and user', async () => {
      const file = { buffer: Buffer.from('fake-bytes') } as Express.Multer.File;
      service.upload.mockResolvedValue({ logo_url: '/schools/aaaaaaaa/logo?v=1' });

      const result = await controller.upload(file, { id: SCHOOL_A, role: 'ADMIN' }, USER, REQUEST);

      expect(service.upload).toHaveBeenCalledWith(SCHOOL_A, file.buffer, 'user-1', {
        ip: '127.0.0.1',
        userAgent: 'vitest',
      });
      expect(result).toEqual({ logo_url: '/schools/aaaaaaaa/logo?v=1' });
    });

    it('rejects a request with no file, without calling the service', async () => {
      await expect(
        controller.upload(undefined as any, { id: SCHOOL_A, role: 'ADMIN' }, USER, REQUEST),
      ).rejects.toThrow(BadRequestException);
      expect(service.upload).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('delegates to the service with the caller tenant and user', async () => {
      await controller.remove({ id: SCHOOL_A, role: 'ADMIN' }, USER, REQUEST);

      expect(service.remove).toHaveBeenCalledWith(SCHOOL_A, 'user-1', {
        ip: '127.0.0.1',
        userAgent: 'vitest',
      });
    });
  });
});
