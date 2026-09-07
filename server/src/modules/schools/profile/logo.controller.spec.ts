import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Readable } from 'stream';
import type { Request, Response } from 'express';
import type { JwtPayload } from '@biddaloy/shared';
import { SchoolLogoController } from './logo.controller';
import { SchoolLogoService } from './logo.service';

const SCHOOL_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const USER = { sub: 'user-1', jti: 'jti-1', memberships: [] } as unknown as JwtPayload;
const REQUEST = { ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } } as unknown as Request;

function fakeService() {
  return { upload: vi.fn(), remove: vi.fn(), serve: vi.fn() };
}

function fakeResponse() {
  return { setHeader: vi.fn() } as unknown as Response;
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

  describe('serve', () => {
    it('serves the logo when the caller is a member of that school', async () => {
      const stream = Readable.from([Buffer.from('png-bytes')]);
      service.serve.mockResolvedValue({ stream, contentType: 'image/png' });
      const res = fakeResponse();

      const result = await controller.serve(SCHOOL_A, { id: SCHOOL_A, role: 'TEACHER' }, res);

      expect(service.serve).toHaveBeenCalledWith(SCHOOL_A);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
      expect(result).toBeDefined();
    });

    it('allows a SUPER_ADMIN to read a different school logo', async () => {
      const stream = Readable.from([Buffer.from('png-bytes')]);
      service.serve.mockResolvedValue({ stream, contentType: 'image/png' });
      const res = fakeResponse();

      await controller.serve(SCHOOL_B, { id: SCHOOL_A, role: 'SUPER_ADMIN' }, res);

      expect(service.serve).toHaveBeenCalledWith(SCHOOL_B);
    });

    it('rejects a member of a different school, without calling the service', async () => {
      const res = fakeResponse();

      await expect(
        controller.serve(SCHOOL_B, { id: SCHOOL_A, role: 'TEACHER' }, res),
      ).rejects.toThrow(ForbiddenException);
      expect(service.serve).not.toHaveBeenCalled();
    });
  });
});
