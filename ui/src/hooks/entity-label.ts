import type { EntityLabel } from '@biddaloy/shared';
import { useTranslation } from 'react-i18next';

/**
 * [30.1.2] Thin seam over `t(entities namespace key for the given EntityLabel)`.
 * Every user-facing entity
 * noun (nav labels, breadcrumbs, page titles, the palette) must render
 * through this hook, not a direct `t()` call, so Epic 35.0 can later swap
 * this body for a per-tenant label lookup (Class -> Course, Section ->
 * Batch, Guardian -> Sponsor) without touching any call site.
 *
 * Today's implementation is deliberately dumb: no tenant lookup, no
 * context provider, no config. That's Epic 35.0's job.
 */
export function useEntityLabel(key: EntityLabel, options?: { count?: number }): string {
  const { t } = useTranslation('common');
  // i18next only applies the `_one`/`_other` plural suffix when `count` is
  // present — an undefined `count` looks up the bare (non-existent) key
  // and falls back to raw-key rendering. Default to the singular form.
  return t(`entities.${key}`, { count: options?.count ?? 1 });
}
