import { describe, it, expect } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PlatformAccessGuard } from '../../platform-identity/platform-access.guard';
import { SchoolAdminsController } from './school-admins.controller';

/**
 * Contract: all four routes sit behind `PlatformAccessGuard` (cockpit token or platform
 * SUPER_ADMIN; its allow/deny cases are in platform-access.guard.spec.ts).
 */
describe('SchoolAdminsController — platform only', () => {
  it('is guarded by PlatformAccessGuard at class level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SchoolAdminsController)).toContain(
      PlatformAccessGuard,
    );
  });
});
