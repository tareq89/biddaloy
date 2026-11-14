import { describe, expect, it } from 'vitest';

import { gateTabs, visibleTab } from './module-gate';

const tab = (id: string, module: string) => ({ id, module, label: id, content: null });

describe('gateTabs', () => {
  const tabs = [tab('overview', 'core'), tab('fines', 'fines'), tab('fees', 'fees')];

  it('keeps core and on modules, drops off ones, strips `module`', () => {
    const shown = gateTabs(tabs, (m) => m !== 'fines');
    expect(shown.map((t) => t.id)).toEqual(['overview', 'fees']);
    expect(shown[0]).not.toHaveProperty('module');
  });

  it('keeps everything when all modules are on', () => {
    expect(gateTabs(tabs, () => true)).toHaveLength(3);
  });
});

describe('visibleTab', () => {
  const shown = [{ id: 'overview' }, { id: 'fees' }];
  it('keeps a tab that is still shown', () => expect(visibleTab(shown, 'fees')).toBe('fees'));
  it('sends a hidden deep link to the first tab', () =>
    expect(visibleTab(shown, 'fines')).toBe('overview'));
});
