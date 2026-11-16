import { describe, it, expect } from 'vitest';
import { assertAppRoleIsNotOwner } from './app-role-check';

const fake = (row: object | null) => ({ query: async () => (row ? [row] : []) });
const ok = { rolsuper: false, rolbypassrls: false, owns_students: false };

describe('assertAppRoleIsNotOwner (D14)', () => {
  it('production refuses a superuser', async () => {
    await expect(
      assertAppRoleIsNotOwner(fake({ ...ok, rolsuper: true }), 'production'),
    ).rejects.toThrow(/Refusing to boot/);
  });
  it('production refuses BYPASSRLS', async () => {
    await expect(
      assertAppRoleIsNotOwner(fake({ ...ok, rolbypassrls: true }), 'production'),
    ).rejects.toThrow(/Refusing to boot/);
  });
  it('production refuses the table owner', async () => {
    await expect(
      assertAppRoleIsNotOwner(fake({ ...ok, owns_students: true }), 'production'),
    ).rejects.toThrow(/Refusing to boot/);
  });
  it('production refuses when the role row is not found', async () => {
    await expect(assertAppRoleIsNotOwner(fake(null), 'production')).rejects.toThrow();
  });
  it('production accepts a plain app role', async () => {
    await expect(assertAppRoleIsNotOwner(fake(ok), 'production')).resolves.toBeUndefined();
  });
  it('outside production it does not even query', async () => {
    const db = {
      query: async () => {
        throw new Error('queried');
      },
    };
    await expect(assertAppRoleIsNotOwner(db, 'test')).resolves.toBeUndefined();
  });
  it('an unset or unknown NODE_ENV is checked, not skipped (fail closed)', async () => {
    await expect(
      assertAppRoleIsNotOwner(fake({ ...ok, rolsuper: true }), undefined),
    ).rejects.toThrow(/Refusing to boot/);
    await expect(
      assertAppRoleIsNotOwner(fake({ ...ok, rolsuper: true }), 'staging'),
    ).rejects.toThrow(/Refusing to boot/);
  });
  it('the demo-reset opt-out skips the check only together with DEMO_MODE=true', async () => {
    await expect(
      assertAppRoleIsNotOwner(fake({ ...ok, rolsuper: true }), 'production', 'true', 'true'),
    ).resolves.toBeUndefined();
  });
  it('the opt-out is ignored outside demo mode (a real school app cannot use it)', async () => {
    await expect(
      assertAppRoleIsNotOwner(fake({ ...ok, rolsuper: true }), 'production', 'true', undefined),
    ).rejects.toThrow(/Refusing to boot/);
    await expect(
      assertAppRoleIsNotOwner(fake({ ...ok, rolsuper: true }), 'production', 'true', 'false'),
    ).rejects.toThrow(/Refusing to boot/);
  });
  it('the refusal never names the role', async () => {
    await expect(
      assertAppRoleIsNotOwner(fake({ ...ok, rolsuper: true }), 'production'),
    ).rejects.not.toThrow(/postgres/);
  });
});
