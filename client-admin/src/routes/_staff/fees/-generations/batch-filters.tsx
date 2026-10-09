/**
 * [16.3.5] Filter descriptor for the Generated fees log — same
 * `FilterFieldDescriptor[]` shape `dues.tsx` builds inline, pulled out to
 * its own file since this one composes an extra data source (the staff
 * list for the "created by" select) that the page component doesn't
 * otherwise need. [B9] The staff list is only requested, and the select
 * only shown, for users with `USER_READ` — otherwise the 403 raised a red
 * toast on every open.
 */
import { FeeGenerationSource, FeeType, Permission } from '@biddaloy/shared';
import { useHasPermission, usersQueryOptions } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { useQuery } from '@tanstack/react-query';

import { SOURCE_LABEL_KEY } from './batch-table';

/** Keys this descriptor writes into the URL — kept alongside
 * `generateFeesSearchSchema` in `generate.tsx` (the Zod schema is the
 * source of truth for what the router persists; this list must stay in
 * sync with it by hand, same as `dues.tsx`'s own filter keys). */
export const BATCH_FILTER_KEYS = [
  'period_from',
  'period_to',
  'fee_type',
  'source',
  'generated_by_user_id',
  'collection_status',
] as const;

export function useBatchFilterFields(): FilterFieldDescriptor[] {
  const { t } = useTranslation('fees');
  // No dedicated "batch generators" endpoint — the full staff list is a
  // reasonable stand-in, same as `dues.tsx` reaching for `useClasses()`
  // wholesale rather than a scoped lookup. Capped at a page-sized 100 so
  // the select stays usable without adding search-as-you-type here.
  const canReadUsers = useHasPermission(Permission.USER_READ);
  const usersQuery = useQuery({
    ...usersQueryOptions({ sort: 'full_name', order: 'asc', limit: 100 }),
    enabled: canReadUsers,
  });

  return [
    {
      kind: 'date-range',
      fromKey: 'period_from',
      toKey: 'period_to',
      label: t('generations.periodRangeLabel'),
      fromLabel: t('generations.periodFromLabel'),
      toLabel: t('generations.periodToLabel'),
    },
    {
      kind: 'select',
      key: 'fee_type',
      label: t('generations.feeTypeLabel'),
      allLabel: t('generations.allFeeTypes'),
      options: Object.values(FeeType).map((feeType) => ({
        value: feeType,
        label: t(`feeType.${feeType}`, { ns: 'common', defaultValue: feeType }),
      })),
    },
    {
      kind: 'select',
      key: 'source',
      label: t('generations.sourceLabel'),
      allLabel: t('generations.allSources'),
      options: Object.values(FeeGenerationSource).map((source) => ({
        value: source,
        label: t(SOURCE_LABEL_KEY[source] ?? 'generations.sourceManual'),
      })),
    },
    ...(canReadUsers
      ? [
          {
            kind: 'select' as const,
            key: 'generated_by_user_id',
            label: t('generations.generatedByLabel'),
            allLabel: t('generations.allGeneratedBy'),
            options: (usersQuery.data?.data ?? []).map((user) => ({
              value: user.id,
              label: user.full_name,
            })),
          },
        ]
      : []),
    {
      kind: 'select',
      key: 'collection_status',
      label: t('generations.collectionStatusLabel'),
      allLabel: t('generations.allCollectionStatuses'),
      options: [
        { value: 'NONE', label: t('generations.collectionStatusNone') },
        { value: 'PARTIAL', label: t('generations.collectionStatusPartial') },
        { value: 'FULL', label: t('generations.collectionStatusFull') },
      ],
    },
  ];
}
