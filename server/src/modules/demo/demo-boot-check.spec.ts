import { describe, it, expect, vi } from 'vitest';
import { assertDemoDatabase } from './demo-boot-check';

type Row = { id: string; slug: string };
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

  it('refuses a database holding a default-school row', async () => {
    await expect(
      check({ DEMO_MODE: 'true' }, [{ id: '1', slug: 'default-school' }]).run(),
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

  it('does not even query when DEMO_MODE is off', async () => {
    const { run, load } = check({}, [{ id: '1', slug: 'real-school' }]);
    await run();
    expect(load).not.toHaveBeenCalled();
  });
});
