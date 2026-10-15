import { describe, expect, it, vi } from 'vitest';

// test/unit-setup.ts undoes env stubs after every test. With `isolate: false` a leaked stub reaches
// later files (PR #2515: DEMO_MODE from push-config.spec turned off TrialScheduler in another file).
// The three tests run in order and share the process, like files sharing a worker thread.
describe('unit-setup env reset', () => {
  it('a spec swaps process.env for a copy', () => {
    process.env = { ...process.env };
  });

  it('a later spec stubs a variable', () => {
    vi.stubEnv('UNIT_SETUP_LEAK_CHECK', 'true');
    expect(process.env.UNIT_SETUP_LEAK_CHECK).toBe('true');
  });

  it('the stub is gone for the next spec', () => {
    expect(process.env.UNIT_SETUP_LEAK_CHECK).toBeUndefined();
  });
});
