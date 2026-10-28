// @vitest-environment node
/** [Epic 42 / #2532] The dashboard guide blocks are built from the widget registry. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROLE_DEFAULT_LAYOUTS, UserRole } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { buildRoleDashboards, buildWidgetSections, WIDGET_KEYS, widgetAnchor } from './dashboard';
import type { GuideLang } from './field-table';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const locale = (lang: string, ns: string) =>
  JSON.parse(readFileSync(path.join(ROOT, `ui/src/i18n/locales/${lang}/${ns}.json`), 'utf8'));
const deps = (lang: GuideLang) => ({
  dashboard: locale(lang, 'dashboard'),
  staff: locale(lang, 'staff'),
  sectionsPage: 'widgets.md',
});

describe.each(['bn', 'en'] as const)('dashboard guide blocks (%s)', (lang) => {
  it('every registry widget has means, source and action help', () => {
    const help = locale(lang, 'dashboard').help.widget;
    for (const key of WIDGET_KEYS)
      for (const line of ['means', 'source', 'action'])
        expect(help[key]?.[line], `${key}.${line}`).toEqual(expect.any(String));
    expect(Object.keys(help).sort()).toEqual([...WIDGET_KEYS].sort());
  });

  it('every widget gets one anchored section', () => {
    const text = buildWidgetSections(lang, deps(lang));
    for (const key of WIDGET_KEYS) expect(text).toContain(`id="${widgetAnchor(key)}"`);
    expect(text.match(/^### /gm)).toHaveLength(WIDGET_KEYS.length);
  });

  it('every role with a dashboard gets a section listing its widgets in order', () => {
    const text = buildRoleDashboards(lang, deps(lang));
    const roles = Object.values(UserRole).filter((r) => ROLE_DEFAULT_LAYOUTS[r].length > 0);
    expect(text.match(/^### /gm)).toHaveLength(roles.length);
    for (const role of roles) {
      const keys = ROLE_DEFAULT_LAYOUTS[role];
      const at = keys.map((k) => text.indexOf(`#${widgetAnchor(k)})`));
      expect(
        at.every((i) => i >= 0),
        role,
      ).toBe(true);
    }
    expect(text).not.toContain(`#${widgetAnchor('no-such-widget')}`);
  });

  it('a widget without help throws, naming the key', () => {
    const d = deps(lang);
    delete d.dashboard.help.widget['sms-balance'];
    expect(() => buildWidgetSections(lang, d)).toThrow(/sms-balance/);
  });
});

describe('golden output (en)', () => {
  it('renders a role bullet and a widget section exactly', () => {
    const d = deps('en');
    expect(buildRoleDashboards('en', d)).toContain(
      '1. [Student attendance today](widgets.md#widget.attendance-today) — Share present today and sections left (shown as a small tile on a phone)',
    );
    const section = buildWidgetSections('en', d).split(/\n\n(?=### )/)[0]!;
    expect(section.split('\n')).toEqual([
      '### Student attendance today <a href="#widget.attendance-today" id="widget.attendance-today"></a>',
      '',
      expect.stringMatching(/^- \*\*What it means:\*\* .+/),
      expect.stringMatching(/^- \*\*Where the number comes from:\*\* .+/),
      expect.stringMatching(/^- \*\*What to do:\*\* .+/),
    ]);
  });
});
