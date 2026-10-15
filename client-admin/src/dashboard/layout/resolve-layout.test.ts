import {
  DashboardWidgetKey as K,
  ROLE_DEFAULT_LAYOUTS,
  UserRole,
  WIDGET_CATALOGUE,
  type DashboardLayoutPref,
  type Permission,
} from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { resolveLayout } from './resolve-layout';

const allow = () => true;
const run = (
  pref?: DashboardLayoutPref,
  can: (p: Permission) => boolean = allow,
  available?: ReadonlySet<K>,
) =>
  resolveLayout({
    role: UserRole.ADMIN,
    pref,
    catalogue: WIDGET_CATALOGUE,
    defaults: ROLE_DEFAULT_LAYOUTS,
    can,
    ...(available ? { available } : {}),
  });
const withFiles = ROLE_DEFAULT_LAYOUTS.ADMIN.filter((k) => !WIDGET_CATALOGUE[k].needsEpic);
const keys = (items: { key: string }[]) => items.map((i) => i.key);

describe('resolveLayout', () => {
  it('uses the role default with each default size when there is no pref', () => {
    const { visible, hidden } = run();
    expect(keys(visible)).toEqual(withFiles);
    expect(hidden).toEqual([]);
    expect(visible.find((i) => i.key === K.ATTENDANCE_TODAY)?.size).toBe('S');
  });

  it('hides needsEpic widgets while no widget file exists (D42, D51)', () => {
    expect(keys(run().visible)).not.toContain(K.APPROVALS_PENDING);
    expect(keys(run().visible)).not.toContain(K.SETUP_CHECKLIST);
  });

  it('shows a needsEpic widget at its default position once available', () => {
    const { visible } = run(undefined, allow, new Set([K.APPROVALS_PENDING]));
    expect(keys(visible).indexOf(K.APPROVALS_PENDING)).toBe(
      ROLE_DEFAULT_LAYOUTS.ADMIN.filter((k) => k !== K.SETUP_CHECKLIST).indexOf(
        K.APPROVALS_PENDING,
      ),
    );
  });

  it('keeps a hidden pref hidden once available', () => {
    const { visible, hidden } = run(
      { widgets: [{ key: K.APPROVALS_PENDING, hidden: true }] },
      allow,
      new Set([K.APPROVALS_PENDING]),
    );
    expect(keys(hidden)).toEqual([K.APPROVALS_PENDING]);
    expect(keys(visible)).not.toContain(K.APPROVALS_PENDING);
  });

  it('available keys without needsEpic change nothing', () => {
    expect(keys(run(undefined, allow, new Set([K.UPCOMING])).visible)).toEqual(keys(run().visible));
  });

  it('permissions still apply to an available needsEpic widget', () => {
    const missing = WIDGET_CATALOGUE[K.APPROVALS_PENDING].permissions[0];
    const { visible } = run(undefined, (p) => p !== missing, new Set([K.APPROVALS_PENDING]));
    expect(keys(visible)).not.toContain(K.APPROVALS_PENDING);
  });

  it('follows the pref order and appends default keys the pref lacks', () => {
    const { visible } = run({ widgets: [{ key: K.UPCOMING }, { key: K.SMS_BALANCE }] });
    expect(keys(visible).slice(0, 2)).toEqual([K.UPCOMING, K.SMS_BALANCE]);
    expect(keys(visible)).toContain(K.ATTENDANCE_TODAY);
    expect(visible).toHaveLength(withFiles.length);
  });

  it('moves hidden items to hidden', () => {
    const { visible, hidden } = run({ widgets: [{ key: K.UPCOMING, hidden: true }] });
    expect(keys(hidden)).toEqual([K.UPCOMING]);
    expect(keys(visible)).not.toContain(K.UPCOMING);
  });

  it('drops unknown keys and keys the role may not show', () => {
    const { visible, hidden } = run({
      widgets: [{ key: 'nope' as K }, { key: K.MY_ROUTINE_TODAY }],
    });
    const all = [...keys(visible), ...keys(hidden)];
    expect(all).not.toContain('nope');
    expect(all).not.toContain(K.MY_ROUTINE_TODAY);
  });

  it('falls back to the first catalogue size when the pref size is not allowed', () => {
    const { visible } = run({ widgets: [{ key: K.SMS_BALANCE, size: 'L' }] });
    expect(visible.find((i) => i.key === K.SMS_BALANCE)?.size).toBe('S');
  });

  it('removes keys whose permission the user lacks from both lists', () => {
    const missing = WIDGET_CATALOGUE.upcoming.permissions[0];
    const { visible, hidden } = run(
      { widgets: [{ key: K.UPCOMING, hidden: true }] },
      (p) => p !== missing,
    );
    expect([...keys(visible), ...keys(hidden)]).not.toContain(K.UPCOMING);
  });
});
