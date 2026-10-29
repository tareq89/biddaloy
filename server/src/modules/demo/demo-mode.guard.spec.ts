import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DemoModeGuard } from './demo-mode.guard';
import { DEMO_DENY_LIST } from './demo-deny-list';

function setup(demoMode: string | undefined) {
  const guard = new DemoModeGuard({
    get: (k: string) => (k === 'DEMO_MODE' ? demoMode : undefined),
  } as unknown as ConfigService);
  const run = (method: string, path: string, headers: Record<string, string> = {}) =>
    guard.canActivate({
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ method, path, headers }),
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext);
  return { run };
}

describe('DemoModeGuard', () => {
  describe('DEMO_MODE on', () => {
    // One row per deny-list entry, so a new entry cannot ship without being exercised.
    it.each(DEMO_DENY_LIST.map((e) => [e.method, e.example, e.reason]))(
      '%s %s is refused with DEMO_DISABLED (%s)',
      (method, example) => {
        const { run } = setup('true');
        expect(() => run(method, `/api/v1${example}`)).toThrowError(
          expect.objectContaining({
            response: expect.objectContaining({ details: { code: 'DEMO_DISABLED' } }),
          }),
        );
      },
    );

    // Opened in 88.1.02: Mailpit holds the messages, bulk routes are capped by the row limit.
    it.each([
      ['POST', '/api/v1/auth/register/start'],
      ['POST', '/api/v1/auth/register/resend'],
      ['POST', '/api/v1/auth/register/verify'],
      ['POST', '/api/v1/auth/otp/request'],
      ['POST', '/api/v1/auth/step-up/otp/request'],
      ['POST', '/api/v1/students/bulk-upload/commit'],
      ['POST', '/api/v1/students/photos/bulk'],
      ['POST', '/api/v1/users/bulk-upload/validate'],
      ['POST', '/api/v1/homework/bulk/commit'],
      ['POST', '/api/v1/calendar-import/commit'],
      ['POST', '/api/v1/study-plans/import/commit'],
    ])('lets the opened route %s %s through', (method, path) => {
      const { run } = setup('true');
      expect(run(method, path)).toBe(true);
    });

    it('lets a normal read through', () => {
      const { run } = setup('true');
      expect(run('GET', '/api/v1/students')).toBe(true);
    });

    // Express routes case-insensitively, so a changed case must not slip past the list.
    it.each([
      ['POST', '/api/v1/AUTH/Change-Password'],
      ['POST', '/API/V1/auth/change-password'],
      ['POST', '/api/v1/backup/RESTORE'],
      ['DELETE', '/api/v1/Users/3f1b2c4d-0000-4000-8000-000000000000'],
      ['POST', '/api/v1/auth/change-password/'],
    ])('refuses the case or slash variant %s %s', (method, path) => {
      const { run } = setup('true');
      expect(() => run(method, path)).toThrowError(
        expect.objectContaining({
          response: expect.objectContaining({ details: { code: 'DEMO_DISABLED' } }),
        }),
      );
    });

    it('refuses an upper-case Content-Type multipart over the cap', () => {
      const { run } = setup('true');
      expect(() =>
        run('POST', '/api/v1/x', {
          'content-type': 'Multipart/Form-Data; boundary=x',
          'content-length': String(3 * 1024 * 1024),
        }),
      ).toThrow();
    });

    it('refuses a multipart upload with no Content-Length', () => {
      const { run } = setup('true');
      expect(() =>
        run('POST', '/api/v1/x', { 'content-type': 'multipart/form-data; boundary=x' }),
      ).toThrowError(
        expect.objectContaining({
          response: expect.objectContaining({ details: { code: 'DEMO_UPLOAD_LIMIT' } }),
        }),
      );
    });

    it('keeps public admission submit open', () => {
      const { run } = setup('true');
      expect(run('POST', '/api/v1/public/admissions/bmsc-high/applicants')).toBe(true);
    });

    it('refuses a 3 MB multipart upload with DEMO_UPLOAD_LIMIT', () => {
      const { run } = setup('true');
      expect(() =>
        run('POST', '/api/v1/students/1/photo', {
          'content-type': 'multipart/form-data; boundary=x',
          'content-length': String(3 * 1024 * 1024),
        }),
      ).toThrowError(
        expect.objectContaining({
          response: expect.objectContaining({ details: { code: 'DEMO_UPLOAD_LIMIT' } }),
        }),
      );
    });

    it('lets a 1 MB multipart upload through', () => {
      const { run } = setup('true');
      expect(
        run('POST', '/api/v1/students/1/photo', {
          'content-type': 'multipart/form-data; boundary=x',
          'content-length': String(1024 * 1024),
        }),
      ).toBe(true);
    });
  });

  describe('DEMO_MODE off', () => {
    it('is a pass-through: no deny-list, no upload cap', () => {
      const { run } = setup(undefined);
      expect(run('POST', '/api/v1/backup/restore')).toBe(true);
      expect(
        run('POST', '/api/v1/students/1/photo', {
          'content-type': 'multipart/form-data; boundary=x',
          'content-length': String(9 * 1024 * 1024),
        }),
      ).toBe(true);
    });

    it('treats any value other than "true" as off', () => {
      expect(setup('1').run('POST', '/api/v1/backup/restore')).toBe(true);
    });
  });
});
