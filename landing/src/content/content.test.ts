import { describe, expect, it } from 'vitest';
import { areas } from './areas';
import { faq } from './faq';
import { roles } from './roles';

// Fixture copied from server/src/modules/demo/demo-accounts.ts `key` fields; keep in sync by hand.
const DEMO_KEYS = ['admin', 'principal', 'accountant', 'class-teacher-8a', 'exam-controller', 'office-staff', 'committee', 'guardian', 'student-9b'];

describe('home content', () => {
  it('has six carousel roles whose keys are demo role keys', () => {
    expect(roles).toHaveLength(6);
    for (const r of roles) expect(DEMO_KEYS, r.key).toContain(r.key);
  });
  it('has at least eight FAQ entries in both languages', () => {
    expect(faq.length).toBeGreaterThanOrEqual(8);
    for (const f of faq) for (const l of ['bn', 'en'] as const) expect(f.q[l] && f.a[l]).toBeTruthy();
  });
  it('has 15 capability areas, each with ops that carry a slug', () => {
    expect(areas).toHaveLength(15);
    for (const a of areas) for (const o of a.ops) expect(o.slug).toMatch(/^[a-z0-9/-]+$/);
  });
});
