import { describe, expect, it } from 'vitest';

import { Permission, ROLE_PERMISSIONS, roleHasPermission } from './permissions';
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

describe('member-remove grant [8.11.8]', () => {
  /**
   * `DELETE /users/{id}` is declared `@Roles(ADMIN)` in
   * `server/src/modules/users/users.controller.ts` and removes only the
   * membership row (school access), not the account. The frontend gates the
   * "Remove from school" action on MEMBER_REMOVE, so only ADMIN may hold it.
   */
  it('grants MEMBER_REMOVE to ADMIN, which the server route admits', () => {
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.MEMBER_REMOVE);
  });

  const ROLES_REFUSED_BY_THE_SERVER = [
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  ] as const;

  for (const role of ROLES_REFUSED_BY_THE_SERVER) {
    it(`withholds MEMBER_REMOVE from ${role}, which the server route refuses`, () => {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.MEMBER_REMOVE);
    });
  }

  // USER_DELETE (true account deletion) is deliberately granted to no staff
  // role — MEMBER_REMOVE must not quietly become a synonym for it.
  it('still grants USER_DELETE to no staff role', () => {
    for (const role of [UserRole.ADMIN, ...ROLES_REFUSED_BY_THE_SERVER]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.USER_DELETE);
    }
  });
});

describe('family read grants [5.1]', () => {
  /**
   * [5.1] opened a set of read routes to PARENT and STUDENT, each guarded by
   * an object-level linkage check (`FamilyAccessService`) rather than by a
   * new permission. The deliberate outcome is that **neither family role
   * gained a permission**: the three reads they already held were always
   * object-scoped, and the server — not this table — decides which objects.
   *
   * This block is the tripwire for that decision. If someone later adds a
   * permission here to "make the portal work", these tests fail and force
   * the question back into review.
   */
  const FAMILY_ROLES = [UserRole.PARENT, UserRole.STUDENT] as const;

  const FAMILY_PERMISSIONS = [
    Permission.STUDENT_READ,
    Permission.FEE_READ,
    Permission.INVOICE_READ,
    Permission.ATTENDANCE_READ,
  ] as const;

  for (const role of FAMILY_ROLES) {
    it(`grants ${role} exactly STUDENT_READ, FEE_READ, INVOICE_READ and ATTENDANCE_READ`, () => {
      expect([...ROLE_PERMISSIONS[role]].sort()).toEqual([...FAMILY_PERMISSIONS].sort());
    });
  }

  // PARENT and STUDENT are byte-identical by design (see audiences.ts) —
  // the portal is one route tree, not two.
  it('gives PARENT and STUDENT the same permission set', () => {
    expect(ROLE_PERMISSIONS[UserRole.PARENT]).toEqual(ROLE_PERMISSIONS[UserRole.STUDENT]);
  });

  /**
   * `GET /payments/student/{studentId}` admits PARENT and STUDENT since
   * [5.1], and already admitted TEACHER and EXECUTIVE. None of them hold
   * PAYMENT_READ, because that permission means the *tenant-wide ledger*
   * (`GET /payments`, ADMIN + ACCOUNTANT). Per-student payment history is
   * authorized by the caller's relationship to the student instead.
   */
  it('withholds PAYMENT_READ from every role the per-student payments route admits but the ledger refuses', () => {
    for (const role of [UserRole.TEACHER, UserRole.EXECUTIVE, UserRole.PARENT, UserRole.STUDENT]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.PAYMENT_READ);
    }
  });

  it('keeps PAYMENT_READ on exactly the roles the tenant-wide ledger route admits', () => {
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.PAYMENT_READ);
    expect(ROLE_PERMISSIONS[UserRole.ACCOUNTANT]).toContain(Permission.PAYMENT_READ);
  });

  /**
   * The roster (`GET /students`) stays staff-only, while `/students/mine`
   * and `/students/{id}` are open to family roles. Both are gated on the
   * same STUDENT_READ — which is precisely why STUDENT_READ was *not* split
   * into STUDENT_READ/STUDENT_LIST: the split would have described a
   * distinction the server already makes at the object level.
   */
  it('keeps STUDENT_READ as the single student-read permission, held by staff and family alike', () => {
    for (const role of [
      UserRole.ADMIN,
      UserRole.ACCOUNTANT,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
      UserRole.PARENT,
      UserRole.STUDENT,
    ]) {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.STUDENT_READ);
    }
    // No STUDENT_LIST was introduced — [5.1] settled against the split.
    expect(Object.keys(Permission)).not.toContain('STUDENT_LIST');
  });

  /**
   * Staff-only write and triage surfaces that [5.1] deliberately did not
   * widen. A family role holding any of these would mean the server's
   * `@Roles` lists and this table had drifted apart again.
   */
  it('withholds every staff-only fee/invoice capability from family roles', () => {
    const STAFF_ONLY = [
      Permission.STUDENT_CREATE,
      Permission.STUDENT_UPDATE,
      Permission.STUDENT_DELETE,
      Permission.STUDENT_BULK_UPLOAD,
      Permission.GUARDIAN_READ,
      Permission.FEE_STRUCTURE_CREATE,
      Permission.FEE_STRUCTURE_UPDATE,
      Permission.FEE_STRUCTURE_DELETE,
      Permission.FEE_GENERATE,
      Permission.FEE_COLLECT,
      Permission.INVOICE_CREATE,
      Permission.INVOICE_DELETE,
      Permission.PAYMENT_RECORD,
      Permission.PAYMENT_REFUND,
      Permission.COMMUNICATION_SEND,
      Permission.REPORTS_VIEW,
      Permission.ATTENDANCE_MARK,
      Permission.ATTENDANCE_CORRECT,
      Permission.ATTENDANCE_DEVICE_MANAGE,
    ] as const;

    for (const role of FAMILY_ROLES) {
      for (const permission of STAFF_ONLY) {
        expect(ROLE_PERMISSIONS[role], `${role} should not hold ${permission}`).not.toContain(
          permission,
        );
      }
    }
  });
});

describe('attendance role grants [9.2]', () => {
  it('grants ATTENDANCE_MARK to TEACHER', () => {
    expect(ROLE_PERMISSIONS[UserRole.TEACHER]).toContain(Permission.ATTENDANCE_MARK);
  });

  it('withholds ATTENDANCE_MARK from ACCOUNTANT', () => {
    expect(ROLE_PERMISSIONS[UserRole.ACCOUNTANT]).not.toContain(Permission.ATTENDANCE_MARK);
  });

  it('grants ATTENDANCE_READ to PARENT and STUDENT', () => {
    expect(ROLE_PERMISSIONS[UserRole.PARENT]).toContain(Permission.ATTENDANCE_READ);
    expect(ROLE_PERMISSIONS[UserRole.STUDENT]).toContain(Permission.ATTENDANCE_READ);
  });

  it('withholds ATTENDANCE_CORRECT from every role except ADMIN and SUPER_ADMIN', () => {
    for (const role of [
      UserRole.ACCOUNTANT,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
      UserRole.PARENT,
      UserRole.STUDENT,
    ]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.ATTENDANCE_CORRECT);
    }
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.ATTENDANCE_CORRECT);
  });
});

describe('[10.4] drift decisions', () => {
  // G3 — resolves the "can import 500 but cannot add one by hand"
  // contradiction: ACCOUNTANT gains create/update on students and guardians.
  it('grants STUDENT_CREATE, STUDENT_UPDATE, GUARDIAN_CREATE and GUARDIAN_UPDATE to ACCOUNTANT', () => {
    for (const permission of [
      Permission.STUDENT_CREATE,
      Permission.STUDENT_UPDATE,
      Permission.GUARDIAN_CREATE,
      Permission.GUARDIAN_UPDATE,
    ]) {
      expect(ROLE_PERMISSIONS[UserRole.ACCOUNTANT]).toContain(permission);
    }
  });

  // G4 — reference-data read every staff screen needs.
  it('grants ACADEMIC_STRUCTURE_READ to every staff role', () => {
    for (const role of [
      UserRole.ADMIN,
      UserRole.ACCOUNTANT,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
    ]) {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.ACADEMIC_STRUCTURE_READ);
    }
  });

  // G5 — the per-student Communications tab, visible via STUDENT_READ.
  it('grants COMMUNICATION_LOG_READ to ACCOUNTANT, EXECUTIVE and TEACHER', () => {
    for (const role of [UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER]) {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.COMMUNICATION_LOG_READ);
    }
  });

  // G6 — the per-entity Activity tab, distinct from the tenant-wide
  // AUDIT_LOG_READ ledger (ADMIN only).
  it('grants AUDIT_ENTITY_HISTORY_READ to every staff role, but AUDIT_LOG_READ to ADMIN only', () => {
    for (const role of [
      UserRole.ADMIN,
      UserRole.ACCOUNTANT,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
    ]) {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.AUDIT_ENTITY_HISTORY_READ);
    }
    for (const role of [UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.AUDIT_LOG_READ);
    }
  });

  // G12 — EXECUTIVE still has no surface for guardians.
  it('withholds GUARDIAN_READ from EXECUTIVE', () => {
    expect(ROLE_PERMISSIONS[UserRole.EXECUTIVE]).not.toContain(Permission.GUARDIAN_READ);
  });

  // G15 — new value mirroring STUDENT_DELETE.
  it('grants GUARDIAN_DELETE to ADMIN only', () => {
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.GUARDIAN_DELETE);
    for (const role of [
      UserRole.ACCOUNTANT,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
      UserRole.PARENT,
      UserRole.STUDENT,
    ]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.GUARDIAN_DELETE);
    }
  });

  // G17 — reserved for endpoints that don't exist yet; granted to ADMIN so
  // the value isn't dead weight, but no route consumes it today (see
  // permission-matrix.e2e-spec.ts's UI_ONLY_PERMISSIONS).
  it('grants INVOICE_DELETE and PAYMENT_REFUND to ADMIN only, and USER_DELETE to no staff role', () => {
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.INVOICE_DELETE);
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.PAYMENT_REFUND);
    for (const role of [
      UserRole.ADMIN,
      UserRole.ACCOUNTANT,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
      UserRole.PARENT,
      UserRole.STUDENT,
    ]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.USER_DELETE);
    }
  });
});

describe('roleHasPermission', () => {
  it('returns true when ADMIN holds USER_CREATE', () => {
    expect(roleHasPermission(UserRole.ADMIN, Permission.USER_CREATE)).toBe(true);
  });

  it('returns false when TEACHER lacks USER_CREATE', () => {
    expect(roleHasPermission(UserRole.TEACHER, Permission.USER_CREATE)).toBe(false);
  });

  it('returns false for a null role', () => {
    expect(roleHasPermission(null, Permission.USER_CREATE)).toBe(false);
  });

  it('returns false for an unrecognized role string', () => {
    expect(roleHasPermission('NOT_A_ROLE', Permission.USER_CREATE)).toBe(false);
  });

  // A role string matching an inherited Object.prototype member (not an own
  // property of ROLE_PERMISSIONS) must resolve to "holds nothing", not throw
  // or fall through to that inherited value.
  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'returns false for the inherited property name %s, not the prototype value',
    (role) => {
      expect(() => roleHasPermission(role, Permission.USER_CREATE)).not.toThrow();
      expect(roleHasPermission(role, Permission.USER_CREATE)).toBe(false);
    },
  );
});

describe('backup role grants [14.2.1]', () => {
  /**
   * Backup export and restore are destructive, tenant-wide operations with
   * no role-scoped partial form, so only ADMIN holds the permission
   * explicitly. SUPER_ADMIN holds it via `Object.values(Permission)`.
   * No server route requires it yet — see UI_ONLY_PERMISSIONS in
   * server/src/permission-matrix.e2e-spec.ts.
   */
  it('grants BACKUP_MANAGE to ADMIN', () => {
    expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toContain(Permission.BACKUP_MANAGE);
  });

  it('grants BACKUP_MANAGE to SUPER_ADMIN, which holds every permission', () => {
    expect(ROLE_PERMISSIONS[UserRole.SUPER_ADMIN]).toContain(Permission.BACKUP_MANAGE);
  });

  const ROLES_WITHOUT_BACKUP = [
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  ] as const;

  for (const role of ROLES_WITHOUT_BACKUP) {
    it(`withholds BACKUP_MANAGE from ${role}`, () => {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.BACKUP_MANAGE);
    });
  }
});
