import { describe, it, expect } from 'vitest';
import { UserRole, CalendarAudience } from '@biddaloy/shared';
import { CalendarViewer, visibilityWhere } from './calendar-visibility.util';

/**
 * Table-driven unit tests for `visibilityWhere`. No database — a minimal
 * fake query builder records every `andWhere` call so each case can assert
 * on the SQL fragment and bound parameters without a real `SelectQueryBuilder`.
 */
class FakeQueryBuilder {
  public calls: Array<{ sql: string; params?: Record<string, unknown> }> = [];

  andWhere(sql: string, params?: Record<string, unknown>): this {
    this.calls.push({ sql, params });
    return this;
  }
}

function run(viewer: CalendarViewer): FakeQueryBuilder {
  const qb = new FakeQueryBuilder();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visibilityWhere(qb as any, viewer);
  return qb;
}

describe('visibilityWhere', () => {
  it.each([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT])(
    '%s sees every event — no filter applied',
    (role) => {
      const qb = run({ role, userId: 'u1', classIds: [] });
      expect(qb.calls).toHaveLength(0);
    },
  );

  it('TEACHER with no classes only sees ALL/STAFF-audience events', () => {
    const qb = run({ role: UserRole.TEACHER, userId: 'u1', classIds: [] });
    expect(qb.calls).toHaveLength(1);
    expect(qb.calls[0].sql).toContain('event.audience IN');
    expect(qb.calls[0].params?.teacherAudiences).toEqual([
      CalendarAudience.ALL,
      CalendarAudience.STAFF,
    ]);
  });

  it('TEACHER with classes sees ALL/STAFF events OR events scoped to their classes', () => {
    const qb = run({ role: UserRole.TEACHER, userId: 'u1', classIds: ['class-1'] });
    expect(qb.calls).toHaveLength(1);
    expect(qb.calls[0].sql).toContain('event.audience IN');
    expect(qb.calls[0].sql).toContain('EXISTS');
    expect(qb.calls[0].params?.viewerClassIds).toEqual(['class-1']);
  });

  it.each([UserRole.PARENT, UserRole.STUDENT])(
    '%s with no linked classes only sees ALL-audience events, never STAFF',
    (role) => {
      const qb = run({ role, userId: 'u1', classIds: [] });
      expect(qb.calls).toHaveLength(1);
      expect(qb.calls[0].sql).toContain('event.audience = :familyAudience');
      expect(qb.calls[0].params?.familyAudience).toBe(CalendarAudience.ALL);
    },
  );

  it('PARENT with linked classes sees ALL events OR events scoped to their child class', () => {
    const qb = run({ role: UserRole.PARENT, userId: 'u1', classIds: ['class-2'] });
    expect(qb.calls).toHaveLength(1);
    expect(qb.calls[0].sql).toContain('EXISTS');
    expect(qb.calls[0].params?.viewerClassIds).toEqual(['class-2']);
  });

  it('PARENT with linked classes still requires audience=ALL — class scope never overrides a STAFF-audience event', () => {
    const qb = run({ role: UserRole.PARENT, userId: 'u1', classIds: ['class-2'] });
    expect(qb.calls).toHaveLength(1);
    // Both branches of the OR are gated on `event.audience = :familyAudience`
    // — there is no path where a STAFF-audience, class-scoped event matches.
    expect(qb.calls[0].sql).toMatch(/^event\.audience = :familyAudience AND/);
  });

  it('an unrecognized role fails closed to no events', () => {
    const qb = run({ role: 'SOME_UNKNOWN_ROLE', userId: 'u1', classIds: [] });
    expect(qb.calls).toHaveLength(1);
    expect(qb.calls[0].sql).toBe('1 = 0');
  });
});
