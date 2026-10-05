import { Card, SkeletonFieldList } from '@biddaloy/ui/components';
import { useGuardian } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatPhone } from '@biddaloy/ui/utils';

import { TabQueryState } from './tab-query-state';

export interface InformationTabProps {
  guardianId: string;
}

/** Same query key as the page header's own `useGuardian(guardianId)` —
 * TanStack Query dedupes both into the one request that fires when the
 * page opens (Information is the default active tab), not two. */
export function InformationTab({ guardianId }: InformationTabProps) {
  const { t } = useTranslation('guardians');
  const regionConfig = useRegionConfig();
  const query = useGuardian(guardianId);

  return (
    <TabQueryState
      query={query}
      // Six label/value pairs, not this route's default table shape —
      // Information is the one guardians tab that renders a `<dl>`.
      skeleton={<SkeletonFieldList fields={6} />}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.loadError')}
    >
      {(guardian) => (
        <Card padded>
          <h2 className="text-h3">{t('detail.information.title')}</h2>
          <dl className="mt-4 grid gap-4 md:grid-cols-3">
            {[
              [
                t('detail.information.columnPhone'),
                guardian.phone
                  ? formatPhone(guardian.phone, regionConfig)
                  : t('detail.information.emptyValue'),
              ],
              [
                t('detail.information.columnAlternatePhone'),
                guardian.alternate_phone
                  ? formatPhone(guardian.alternate_phone, regionConfig)
                  : t('detail.information.emptyValue'),
              ],
              // `||`, not `??` — a cleared field comes back as `''`, not `null`
              // (see `-edit-guardian-dialog.tsx`'s own comment), and both should
              // fall back to the empty-state placeholder rather than render blank.
              [
                t('detail.information.columnEmail'),
                guardian.email || t('detail.information.emptyValue'),
              ],
              [
                t('detail.information.columnOccupation'),
                guardian.occupation || t('detail.information.emptyValue'),
              ],
              [
                t('detail.information.columnPreferredCommunication'),
                t(`preferredCommunicationOptions.${guardian.preferred_communication}`),
              ],
              [
                t('detail.information.columnAddress'),
                guardian.address || t('detail.information.emptyValue'),
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-caption text-text-secondary">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
    </TabQueryState>
  );
}
