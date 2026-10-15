import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from './validate-cli';
import type { Violation } from './validator';

// The exit code is the nightly reset's swap gate (scripts/demo/reset.sh): only 0 lets a new demo
// database go live. A regression that returned 0 on a violation would ship a broken demo.
describe('validate-cli main (the reset swap gate)', () => {
  const fakeDs = () => ({ initialize: vi.fn(), destroy: vi.fn(), query: vi.fn() });
  const violation: Violation = { check: 'money', message: 'ledger does not balance' };

  afterEach(() => vi.restoreAllMocks());

  it('returns 0 when the validator finds no violations', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const ds = fakeDs();
    expect(await main(ds, async () => [])).toBe(0);
    expect(ds.destroy).toHaveBeenCalled();
  });

  it('returns 1 when the validator finds one violation', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ds = fakeDs();
    expect(await main(ds, async () => [violation])).toBe(1);
    expect(ds.destroy).toHaveBeenCalled();
  });

  it('returns 1 when the validator throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ds = fakeDs();
    const failing = async (): Promise<Violation[]> => {
      throw new Error('query failed');
    };
    expect(await main(ds, failing)).toBe(1);
    expect(ds.destroy).toHaveBeenCalled();
  });

  it('reports the validator error, not a teardown error that follows it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ds = { ...fakeDs(), destroy: vi.fn().mockRejectedValue(new Error('teardown broke')) };
    const failing = async (): Promise<Violation[]> => {
      throw new Error('query failed');
    };
    expect(await main(ds, failing)).toBe(1);
    expect(errors).toHaveBeenCalledWith('query failed');
  });

  it('returns 1 when the database cannot be reached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ds = { ...fakeDs(), initialize: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    expect(await main(ds, async () => [])).toBe(1);
  });
});
