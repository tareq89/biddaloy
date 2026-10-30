import { describe, it, expect, vi } from 'vitest';
import { assertDemoDatabase } from './demo-boot-check';

type Row = {
  id: string;
  slug: string;
  has_students?: boolean;
  created_in_demo?: boolean;
};
const check = (env: Record<string, string | undefined>, schools: Row[]) => {
  const load = vi.fn().mockResolvedValue(schools);
  return { run: () => assertDemoDatabase(env as NodeJS.ProcessEnv, load), load };
};

describe('assertDemoDatabase (runs in main.ts before NestFactory.create)', () => {
  it('refuses a database holding a non-demo school', async () => {
    await expect(
      check({ DEMO_MODE: 'true' }, [
        { id: '1', slug: 'bmsc-high' },
        { id: '2', slug: 'real-school' },
      ]).run(),
    ).rejects.toThrow(/real-school/);
  });

  // Every migrated DB has default-school (MultiTenantAuth migration, random uuid), so a correctly
  // built demo DB holds it too. The seed runner's guard 3 allows it for the same reason.
  it('passes with the migrated default-school row next to the bmsc-* rows', async () => {
    await expect(
      check({ DEMO_MODE: 'true' }, [
        { id: 'random-uuid', slug: 'default-school' },
        { id: '2', slug: 'bmsc-high' },
      ]).run(),
    ).resolves.toBeUndefined();
  });

  it('still refuses default-school next to a real school', async () => {
    await expect(
      check({ DEMO_MODE: 'true' }, [
        { id: '1', slug: 'default-school' },
        { id: '2', slug: 'real-school' },
      ]).run(),
    ).rejects.toThrow(/real-school/);
  });

  // A pre-multi-tenant install moved all its real data into default-school, so a default-school
  // with students is a real database, not the empty platform row.
  it('refuses default-school with students', async () => {
    await expect(
      check({ DEMO_MODE: 'true' }, [
        { id: '1', slug: 'default-school', has_students: true },
        { id: '2', slug: 'bmsc-high' },
      ]).run(),
    ).rejects.toThrow(/default-school/);
  });

  it('passes with only bmsc-* rows', async () => {
    await expect(
      check({ DEMO_MODE: 'true' }, [
        { id: '1', slug: 'bmsc-primary' },
        { id: '2', slug: 'bmsc-high' },
        { id: '3', slug: 'bmsc-college' },
      ]).run(),
    ).resolves.toBeUndefined();
  });

  it('excepts an explicitly configured platform tenant', async () => {
    await expect(
      check({ DEMO_MODE: 'true', PLATFORM_TENANT_ID: 'p' }, [
        { id: 'p', slug: 'platform' },
        { id: '2', slug: 'bmsc-high' },
      ]).run(),
    ).resolves.toBeUndefined();
  });

  // A legacy install's env names its default-school row as the platform tenant; copying that env
  // with DEMO_MODE=true must not let the exemption skip the students check.
  it('refuses a platform tenant with students', async () => {
    await expect(
      check({ DEMO_MODE: 'true', PLATFORM_TENANT_ID: 'p' }, [
        { id: 'p', slug: 'default-school', has_students: true },
        { id: '2', slug: 'bmsc-high' },
      ]).run(),
    ).rejects.toThrow(/default-school/);
  });

  // Epic 88 D3: the flag alone decides. A visitor can add 100 rows per request, so no student count
  // may turn a visitor school into "foreign" and stop the public demo from booting. The check reads
  // no count at all, so a 60- or 5000-student visitor school is the same row as a 3-student one.
  it.each([3, 60, 5000])('passes a visitor-created school with %i students', async (n) => {
    await expect(
      check({ DEMO_MODE: 'true' }, [
        { id: '1', slug: 'bmsc-high' },
        { id: '2', slug: `visitor-school-${n}`, has_students: true, created_in_demo: true },
      ]).run(),
    ).resolves.toBeUndefined();
  });

  it('passes an empty visitor-created school (a branch with no students yet)', async () => {
    await expect(
      check({ DEMO_MODE: 'true' }, [
        { id: '1', slug: 'bmsc-high' },
        { id: '2', slug: 'visitor-branch', has_students: false, created_in_demo: true },
      ]).run(),
    ).resolves.toBeUndefined();
  });

  it('refuses a non-demo school without the flag', async () => {
    await expect(
      check({ DEMO_MODE: 'true' }, [
        { id: '2', slug: 'visitor-school', has_students: true, created_in_demo: false },
      ]).run(),
    ).rejects.toThrow(/visitor-school/);
  });

  // The refusal must say why, so a 02:00 exit 1 after the nightly reset (#2178) is not silent.
  // It must not suggest setting PLATFORM_TENANT_ID as a fix: an empty default-school is already exempt by slug.
  it('says why it refuses', async () => {
    await expect(
      check({ DEMO_MODE: 'true' }, [{ id: '1', slug: 'real-school' }]).run(),
    ).rejects.toThrow(/real-school.*not a demo database/);
  });

  it('does not even query when DEMO_MODE is off', async () => {
    const { run, load } = check({}, [{ id: '1', slug: 'real-school' }]);
    await run();
    expect(load).not.toHaveBeenCalled();
  });
});
