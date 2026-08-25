import { describe, expect, it } from 'vitest';

import { Permission, ROLE_PERMISSIONS } from './permissions';
import { UserRole } from './index';

describe('bulk-upload role grants [8.11.8]', () => {
  /**
   * `POST /students/bulk-upload` is declared
   * `@Roles(ADMIN, ACCOUNTANT, EXECUTIVE)` in
   * `server/src/modules/students/students.controller.ts`. The frontend gates
   * the import page and its entry button on `STUDENT_BULK_UPLOAD`, so this
   * list has to agree with that decorator: a role that can call the endpoint
   * but cannot see the button experiences a missing feature, not a refusal.
   */
  const ROLES_ALLOWED_BY_THE_SERVER = [
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
  ] as const;

  for (const role of ROLES_ALLOWED_BY_THE_SERVER) {
    it(`grants STUDENT_BULK_UPLOAD to ${role}, which the server route admits`, () => {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.STUDENT_BULK_UPLOAD);
    });
  }

  // SUPER_ADMIN is not on the route's `@Roles` list but holds every
  // permission by design; it is exempt from the agreement check above.
  const ROLES_REFUSED_BY_THE_SERVER = [
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  ] as const;

  for (const role of ROLES_REFUSED_BY_THE_SERVER) {
    it(`withholds STUDENT_BULK_UPLOAD from ${role}, which the server route refuses`, () => {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.STUDENT_BULK_UPLOAD);
    });
  }

  // Importing students creates them, so any role that may bulk-upload must
  // also be able to read the students it just created.
  it('pairs every bulk-upload grant with STUDENT_READ', () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      if (permissions.includes(Permission.STUDENT_BULK_UPLOAD)) {
        expect(permissions, `${role} can bulk-upload but cannot read students`).toContain(
          Permission.STUDENT_READ,
        );
      }
    }
  });
});
