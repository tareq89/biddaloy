import { describe, expect, it } from 'vitest';

import { UserRole } from './index';
import { roleHasPermission } from './permissions';
import * as A from './applications';

const rows = Object.entries(A.APPLICATION_TYPES) as [A.ApplicationType, A.ApplicationTypeDef][];

describe('applications enums [52.1.1]', () => {
  it('every enum value equals its key', () => {
    for (const e of [
      A.ApplicationType,
      A.ApplicationStatus,
      A.ApplicationSource,
      A.ApplicationEventKind,
      A.StudentLeaveReason,
      A.ApplicationAddressee,
      A.ApplicationSubjectKind,
    ]) {
      for (const [k, v] of Object.entries(e)) expect(v).toBe(k);
    }
  });

  it('has the contracted member counts', () => {
    expect(Object.keys(A.ApplicationType)).toHaveLength(10);
    expect(Object.keys(A.ApplicationStatus)).toHaveLength(6);
    expect(Object.keys(A.ApplicationEventKind)).toHaveLength(9);
  });

  it('every type has a catalogue row with >=1 step and >=1 subject', () => {
    for (const t of Object.values(A.ApplicationType)) {
      const d = A.APPLICATION_TYPES[t];
      expect(d, t).toBeDefined();
      expect(d.steps.length, t).toBeGreaterThanOrEqual(1);
      expect(d.subject.length, t).toBeGreaterThanOrEqual(1);
    }
  });

  it('AUTO types with effectPermission end on a step that grants it', () => {
    for (const [t, d] of rows) {
      if (d.effect !== 'AUTO' || !d.effectPermission) continue;
      const last = d.steps[d.steps.length - 1];
      if (last.kind === 'PERMISSION') expect(last.permission, t).toBe(d.effectPermission);
      else if (last.kind === 'ROLES') {
        for (const r of last.roles)
          expect(roleHasPermission(r, d.effectPermission), `${t}/${r}`).toBe(true);
      } else expect.fail(`${t} last step is ${last.kind}`);
    }
  });

  it('only GENERAL uses ADDRESSEE, with effect NONE', () => {
    for (const [t, d] of rows) {
      const uses = d.steps.some((s) => s.kind === 'ADDRESSEE');
      expect(uses, t).toBe(t === A.ApplicationType.GENERAL);
      if (uses) expect(d.effect).toBe('NONE');
    }
  });

  it('only FEE_WAIVER is not bulk-approvable; only the leave types are cancellable', () => {
    expect(rows.filter(([, d]) => !d.bulkApprovable).map(([t]) => t)).toEqual([
      A.ApplicationType.FEE_WAIVER,
    ]);
    expect(
      rows
        .filter(([, d]) => d.cancellable)
        .map(([t]) => t)
        .sort(),
    ).toEqual([A.ApplicationType.STAFF_LEAVE, A.ApplicationType.STUDENT_LEAVE].sort());
  });

  it('pins override roles and attachment limits', () => {
    expect([...A.APPLICATION_OVERRIDE_ROLES]).toEqual([UserRole.ADMIN, UserRole.EXECUTIVE]);
    expect(A.ATTACHMENT_LIMITS.maxFiles).toBe(3);
    expect(A.ATTACHMENT_LIMITS.maxBytes).toBe(5 * 1024 * 1024);
    expect([...A.ATTACHMENT_LIMITS.mime]).toEqual(['application/pdf', 'image/jpeg', 'image/png']);
  });
});
