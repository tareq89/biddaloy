import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DemoModeGuard } from './demo-mode.guard';
import { DEMO_DENY_LIST } from './demo-deny-list';

function setup(demoMode: string | undefined) {
  const guard = new DemoModeGuard({
    get: (k: string) => (k === 'DEMO_MODE' ? demoMode : undefined),
  } as unknown as ConfigService);
  const setHeader = vi.fn();
  const run = (method: string, path: string, headers: Record<string, string> = {}) =>
    guard.canActivate({
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ method, path, headers }),
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext);
  return { run, setHeader };
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

    it('lets a normal read through and marks it noindex', () => {
      const { run, setHeader } = setup('true');
      expect(run('GET', '/api/v1/students')).toBe(true);
      expect(setHeader).toHaveBeenCalledWith('X-Robots-Tag', 'noindex, nofollow');
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
    it('is a pass-through: no deny-list, no upload cap, no header', () => {
      const { run, setHeader } = setup(undefined);
      expect(run('POST', '/api/v1/backup/restore')).toBe(true);
      expect(
        run('POST', '/api/v1/students/1/photo', {
          'content-type': 'multipart/form-data; boundary=x',
          'content-length': String(9 * 1024 * 1024),
        }),
      ).toBe(true);
      expect(setHeader).not.toHaveBeenCalled();
    });

    it('treats any value other than "true" as off', () => {
      expect(setup('1').run('POST', '/api/v1/backup/restore')).toBe(true);
    });
  });
});
