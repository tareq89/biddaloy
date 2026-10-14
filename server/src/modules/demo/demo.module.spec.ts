import 'reflect-metadata';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { DemoBootGuard } from './demo-boot.guard';

function boot(env: Record<string, string | undefined>, schools: { id: string; slug: string }[]) {
  const query = vi.fn().mockResolvedValue(schools);
  const guard = new DemoBootGuard(
    { get: (k: string) => env[k] } as unknown as ConfigService,
    { query } as unknown as DataSource,
  );
  return { run: () => guard.onApplicationBootstrap(), query };
}

describe('DemoBootGuard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('exits when the database holds a default-school row', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await boot({ DEMO_MODE: 'true' }, [{ id: '1', slug: 'default-school' }]).run();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('passes with only bmsc-* rows', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await boot({ DEMO_MODE: 'true' }, [
      { id: '1', slug: 'bmsc-primary' },
      { id: '2', slug: 'bmsc-high' },
      { id: '3', slug: 'bmsc-college' },
    ]).run();
    expect(exit).not.toHaveBeenCalled();
  });

  it('excepts an explicitly configured platform tenant', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await boot({ DEMO_MODE: 'true', PLATFORM_TENANT_ID: 'p' }, [
      { id: 'p', slug: 'platform' },
      { id: '2', slug: 'bmsc-high' },
    ]).run();
    expect(exit).not.toHaveBeenCalled();
  });

  it('does not even query when DEMO_MODE is off', async () => {
    const { run, query } = boot({}, [{ id: '1', slug: 'default-school' }]);
    await run();
    expect(query).not.toHaveBeenCalled();
  });
});
