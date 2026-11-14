/**
 * [77.3 / #3921, D16, D37] Every tab, portal page, dashboard widget and Reports-hub link names its
 * module, or `'core'` on purpose. A new one with neither fails here, so nothing ships that an off
 * module cannot hide.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DashboardWidgetKey, ModuleKey } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { WIDGET_MODULES } from './dashboard/widgets/registry';
import { CODED_REPORTS } from './routes/_staff/reports/-coded-reports';
import { PORTAL_NAV_ITEMS } from './routes/portal';

const VALID = new Set<string>([...Object.values(ModuleKey), 'core']);
const here = (p: string) => join(__dirname, p);

// Detail pages build their tab list inline; `id:`s inside it each need a `module:` beside them.
const TAB_FILES = [
  'routes/_staff/students/$studentId.tsx',
  'routes/_staff/guardians/$guardianId.tsx',
  'routes/_staff/classes/$classId.tsx',
  'routes/_staff/staff/$userId.tsx',
];

describe('tab / card coverage', () => {
  it.each(TAB_FILES)('every tab in %s declares a valid module', (file) => {
    const src = readFileSync(here(file), 'utf8');
    // An `id:` whose object reaches a `content:` before the next `id:` is a tab (actions have none).
    const tabs = [
      ...src.matchAll(
        /\n\s+id: '([\w-]+)',\n(\s+module: '(\w+)',\n)?(?:(?!\n\s+id:)[\s\S])*?\n\s+content:/g,
      ),
    ];
    expect(tabs.length).toBeGreaterThan(0);
    for (const [, id, , module] of tabs) {
      expect(module, `tab "${id}" has no module`).toBeDefined();
      expect(VALID.has(module!), `tab "${id}" has unknown module "${module}"`).toBe(true);
    }
    expect([...src.matchAll(/\n\s+content:/g)].length).toBe(tabs.length);
  });

  it('every portal page declares a valid module', () => {
    for (const item of PORTAL_NAV_ITEMS) {
      expect(VALID.has(item.module), `${item.to} has module "${String(item.module)}"`).toBe(true);
    }
  });

  it('every dashboard widget key declares a valid module', () => {
    expect(Object.keys(WIDGET_MODULES).sort()).toEqual(Object.values(DashboardWidgetKey).sort());
    for (const [key, module] of Object.entries(WIDGET_MODULES)) {
      expect(VALID.has(module), `${key} has module "${module}"`).toBe(true);
    }
  });

  it('every coded report declares a valid module', () => {
    for (const report of CODED_REPORTS) {
      expect(VALID.has(report.module), `${report.id} has module "${String(report.module)}"`).toBe(
        true,
      );
    }
  });
});
