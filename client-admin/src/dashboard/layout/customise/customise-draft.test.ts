import {
  DashboardWidgetKey as K,
  ROLE_DEFAULT_LAYOUTS,
  UserRole,
  WIDGET_CATALOGUE,
} from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { resolveLayout } from '../resolve-layout';

import { customiseReducer, toPref, type DraftState } from './customise-draft';

const seed = (): DraftState => {
  const { visible, hidden } = resolveLayout({
    role: UserRole.EXECUTIVE,
    pref: undefined,
    catalogue: WIDGET_CATALOGUE,
    defaults: ROLE_DEFAULT_LAYOUTS,
    can: () => true,
  });
  return { shown: visible, hidden };
};
const keys = (items: { key: string }[]) => items.map((i) => i.key);

describe('customiseReducer', () => {
  it('toggle hides to the top of hidden and shows to the end of shown', () => {
    let s = customiseReducer(seed(), { type: 'toggle', key: K.UPCOMING });
    s = customiseReducer(s, { type: 'toggle', key: K.STAFF_TODAY });
    expect(keys(s.hidden)).toEqual([K.STAFF_TODAY, K.UPCOMING]);
    expect(keys(s.shown)).not.toContain(K.UPCOMING);
    s = customiseReducer(s, { type: 'toggle', key: K.UPCOMING });
    expect(keys(s.shown).at(-1)).toBe(K.UPCOMING);
    expect(keys(s.hidden)).toEqual([K.STAFF_TODAY]);
  });

  it('move swaps with the neighbour and is a no-op at the ends', () => {
    const s0 = seed();
    const first = s0.shown[0]!.key;
    const second = s0.shown[1]!.key;
    expect(customiseReducer(s0, { type: 'move', key: first, dir: -1 })).toBe(s0);
    const down = customiseReducer(s0, { type: 'move', key: first, dir: 1 });
    expect(keys(down.shown).slice(0, 2)).toEqual([second, first]);
    const last = s0.shown.at(-1)!.key;
    expect(customiseReducer(s0, { type: 'move', key: last, dir: 1 })).toBe(s0);
    const up = customiseReducer(down, { type: 'move', key: first, dir: -1 });
    expect(keys(up.shown)).toEqual(keys(s0.shown));
  });

  it('resize rejects a size that is not in the catalogue', () => {
    const s0 = seed();
    expect(customiseReducer(s0, { type: 'resize', key: K.ATTENDANCE_TODAY, size: 'L' })).toBe(s0);
    const s1 = customiseReducer(s0, { type: 'resize', key: K.ATTENDANCE_TODAY, size: 'M' });
    expect(s1.shown.find((i) => i.key === K.ATTENDANCE_TODAY)?.size).toBe('M');
  });

  it('reset restores the given defaults', () => {
    const defaults = seed();
    const s = customiseReducer(defaults, { type: 'toggle', key: K.UPCOMING });
    expect(customiseReducer(s, { type: 'reset', defaults })).toBe(defaults);
  });

  it('toPref round-trips through resolveLayout to the same order', () => {
    let s = customiseReducer(seed(), { type: 'move', key: K.UPCOMING, dir: -1 });
    s = customiseReducer(s, { type: 'toggle', key: K.STAFF_TODAY });
    const back = resolveLayout({
      role: UserRole.EXECUTIVE,
      pref: toPref(s),
      catalogue: WIDGET_CATALOGUE,
      defaults: ROLE_DEFAULT_LAYOUTS,
      can: () => true,
    });
    expect(back.visible).toEqual(s.shown);
    expect(back.hidden).toEqual(s.hidden);
  });
});
