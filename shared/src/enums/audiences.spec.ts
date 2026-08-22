import { describe, expect, it } from 'vitest';

import { GUARDIAN_ROLES, isGuardianRole, isStaffRole, STAFF_ROLES } from './audiences';
import { UserRole } from './index';

describe('route audiences [8.9.10]', () => {
  // The guard against a role added later silently defaulting into one
  // audience — the route tree would either hide the whole app from it or
  // hand it staff chrome, and neither failure is visible from the enum.
  it('places every UserRole in exactly one audience', () => {
    for (const role of Object.values(UserRole)) {
      const inGuardian = (GUARDIAN_ROLES as readonly string[]).includes(role);
      const inStaff = (STAFF_ROLES as readonly string[]).includes(role);
      expect(inGuardian !== inStaff, `${role} must be in exactly one audience`).toBe(true);
    }
  });

  it('treats PARENT and STUDENT as the guardian audience', () => {
    expect(isGuardianRole(UserRole.PARENT)).toBe(true);
    expect(isGuardianRole(UserRole.STUDENT)).toBe(true);
    expect(isGuardianRole(UserRole.ADMIN)).toBe(false);
  });

  it('treats an absent or unrecognised role as neither audience', () => {
    expect(isGuardianRole(null)).toBe(false);
    expect(isStaffRole(null)).toBe(false);
    expect(isGuardianRole('HEADMASTER')).toBe(false);
    expect(isStaffRole('HEADMASTER')).toBe(false);
  });
});
