/**
 * [169.2-10] Role default + the user's saved layout -> what to show and what
 * is hidden. Pure. Knows nothing about which widget components exist: the
 * grid skips a visible key with no file, customise still lists it.
 *
 * `needsEpic` is NOT used to hide widgets: the epics it names have shipped
 * (decision for this lane; supersedes D42).
 */
import type {
  DashboardLayoutItem,
  DashboardLayoutPref,
  DashboardWidgetKey,
  Permission,
  UserRole,
  WidgetCatalogueEntry,
  WidgetSize,
} from '@biddaloy/shared';

import { WIDGET_COMPONENTS } from '../widgets/registry';

export interface LayoutItem {
  key: DashboardWidgetKey;
  size: WidgetSize;
}

export interface ResolveLayoutInput {
  role: UserRole;
  pref: DashboardLayoutPref | undefined;
  catalogue: Record<DashboardWidgetKey, WidgetCatalogueEntry>;
  defaults: Record<UserRole, DashboardWidgetKey[]>;
  can: (permission: Permission) => boolean;
  /** Keys whose widget file exists; defaults to the file registry. */
  available?: ReadonlySet<DashboardWidgetKey>;
}

const FILE_KEYS: ReadonlySet<DashboardWidgetKey> = new Set(WIDGET_COMPONENTS.keys());

export function resolveLayout({
  role,
  pref,
  catalogue,
  defaults,
  can,
  available = FILE_KEYS,
}: ResolveLayoutInput) {
  const allowed = (key: DashboardWidgetKey) => {
    const entry = catalogue[key] as WidgetCatalogueEntry | undefined;
    return Boolean(
      entry?.roles.includes(role) &&
      entry.permissions.every(can) &&
      (!entry.needsEpic || available.has(key)),
    );
  };
  const fromPref = pref?.widgets ?? [];
  const seen = new Set(fromPref.map((w) => w.key));
  const rows: DashboardLayoutItem[] = [
    ...fromPref,
    ...(defaults[role] ?? []).filter((k) => !seen.has(k)).map((key) => ({ key })),
  ].filter((w) => allowed(w.key));

  const visible: LayoutItem[] = [];
  const hidden: LayoutItem[] = [];
  for (const row of rows) {
    const sizes = catalogue[row.key].sizes;
    const size = row.size && sizes.includes(row.size) ? row.size : sizes[0]!;
    (row.hidden ? hidden : visible).push({ key: row.key, size });
  }
  return { visible, hidden };
}
