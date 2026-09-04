import { describe, expect, it, vi } from 'vitest';

import { loadRouteNamespaces } from './route-loaders';

// `vi.hoisted` so this mock function exists before `vi.mock`'s factory
// (itself hoisted above every import) runs — a plain `vi.fn()` declared
// below `vi.mock` would be `undefined` inside the factory at hoist time.
// Referencing it directly (rather than through `i18n.loadNamespaces`,
// an object-method access) also sidesteps `@typescript-eslint/
// unbound-method`, which `i18n.loadNamespaces` would otherwise trip.
const { loadNamespaces } = vi.hoisted(() => ({ loadNamespaces: vi.fn() }));

vi.mock('@biddaloy/ui/i18n', () => ({
  i18n: { loadNamespaces },
}));

describe('loadRouteNamespaces', () => {
  it('forwards every namespace argument to i18n.loadNamespaces as an array', () => {
    void loadRouteNamespaces('students', 'common');
    expect(loadNamespaces).toHaveBeenCalledWith(['students', 'common']);
  });

  it('forwards a single namespace the same way', () => {
    void loadRouteNamespaces('studentImport');
    expect(loadNamespaces).toHaveBeenCalledWith(['studentImport']);
  });

  // A route's `loader` runs inside TanStack Router's own promise
  // handling — if `i18n.loadNamespaces` rejected synchronously (threw
  // rather than returning a rejected promise) it would break out of that
  // machinery instead of surfacing as a normal loader failure.
  it("does not throw synchronously when i18n.loadNamespaces's promise rejects", async () => {
    loadNamespaces.mockReturnValueOnce(Promise.reject(new Error('network down')));

    let thrown: unknown;
    let result: Promise<unknown> | undefined;
    try {
      result = loadRouteNamespaces('students');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeUndefined();
    await expect(result).rejects.toThrow('network down');
  });
});
