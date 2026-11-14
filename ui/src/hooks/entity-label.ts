import type { EntityLabel } from '@biddaloy/shared';
import { useTranslation } from 'react-i18next';

/**
 * [30.1.2] Thin seam over `t(entities namespace key for the given EntityLabel)`.
 * Every user-facing entity
 * noun (nav labels, breadcrumbs, page titles, the palette) must render
 * through this hook, not a direct `t()` call, so tenant renames reach every
 * call site.
 *
 * [Epic 77] The seam is fulfilled without changing this body: tenant words
 * (Class -> Course, Section -> Batch, ...) are applied as i18n resource
 * overrides by `applyTenantWords` when the school profile loads.
 */
export function useEntityLabel(key: EntityLabel, options?: { count?: number }): string {
  const { t } = useTranslation('common');
  // i18next only applies the `_one`/`_other` plural suffix when `count` is
  // present — an undefined `count` looks up the bare (non-existent) key
  // and falls back to raw-key rendering. Default to the singular form.
  return t(`entities.${key}`, { count: options?.count ?? 1 });
}
