/**
 * [Epic 42 / #2532, D25] The two generated blocks of the dashboard guide pages,
 * built from the widget registry in `shared/` and the i18n files, so the guide
 * cannot drift from the code.
 *
 *   <!-- guide:generated:widgets:roles -->     buildRoleDashboards: per role, its default widgets in order
 *   <!-- guide:generated:widgets:sections -->  buildWidgetSections: one `### <title>` section per widget
 *
 * i18n (`ui/src/i18n/locales/<lang>/dashboard.json`):
 *   widgets.<key>.title / .description      what the card is called
 *   help.widget.<key>.{means,source,action} the three lines of the section
 * A widget missing any of the three throws, so a new widget cannot ship undocumented.
 */
import {
  DashboardWidgetKey,
  ROLE_DEFAULT_LAYOUTS,
  UserRole,
  WIDGET_CATALOGUE,
} from '@biddaloy/shared';

import type { GuideLang } from './field-table';

type Json = { [k: string]: unknown };
export interface DashboardDeps {
  dashboard: Json; // ui/src/i18n/locales/<lang>/dashboard.json
  staff: Json; // .../staff.json (role names)
  /** Page the widget sections live on, relative to the page that shows the role list. */
  sectionsPage: string;
}

const LINES: Record<GuideLang, { means: string; source: string; action: string; phone: string }> = {
  bn: {
    means: 'এর মানে',
    source: 'সংখ্যাটি কোথা থেকে আসে',
    action: 'কী করবেন',
    phone: 'ফোনে ছোট ঘর হিসেবে দেখায়',
  },
  en: {
    means: 'What it means',
    source: 'Where the number comes from',
    action: 'What to do',
    phone: 'shown as a small tile on a phone',
  },
};

const text = (o: Json, pathKey: string): string => {
  const v = pathKey.split('.').reduce<unknown>((acc, k) => (acc as Json | undefined)?.[k], o);
  if (typeof v !== 'string' || !v.trim()) throw new Error(`dashboard.json: missing "${pathKey}"`);
  return v.trim().replace(/\s*\n\s*/g, ' ');
};

export const WIDGET_KEYS = Object.values(DashboardWidgetKey);
/** The anchor Epic 44 links to (helpId `widget.<key>`). */
export const widgetAnchor = (key: string) => `widget.${key}`;

/** One bullet per default widget, per role that has a dashboard, in the registry's order. */
export function buildRoleDashboards(lang: GuideLang, d: DashboardDeps): string {
  const out: string[] = [];
  for (const role of Object.values(UserRole)) {
    const keys = ROLE_DEFAULT_LAYOUTS[role];
    if (!keys.length) continue;
    out.push(`### ${text(d.staff, `roles.${role}`)}`, '');
    keys.forEach((key, i) => {
      const phone = WIDGET_CATALOGUE[key].phoneTile ? ` (${LINES[lang].phone})` : '';
      out.push(
        `${i + 1}. [${text(d.dashboard, `widgets.${key}.title`)}](${d.sectionsPage}#${widgetAnchor(key)}) — ${text(d.dashboard, `widgets.${key}.description`)}${phone}`,
      );
    });
    out.push('');
  }
  return out.join('\n').trim();
}

/** Registry order. Each section ends in the three help lines. */
export function buildWidgetSections(lang: GuideLang, d: DashboardDeps): string {
  const l = LINES[lang];
  return WIDGET_KEYS.map((key) => {
    const title = text(d.dashboard, `widgets.${key}.title`);
    const line = (k: 'means' | 'source' | 'action') =>
      `- **${l[k]}:** ${text(d.dashboard, `help.widget.${key}.${k}`)}`;
    return [
      `### ${title} <a href="#${widgetAnchor(key)}" id="${widgetAnchor(key)}"></a>`,
      '',
      line('means'),
      line('source'),
      line('action'),
    ].join('\n');
  }).join('\n\n');
}
