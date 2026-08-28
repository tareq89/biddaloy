import { SkeletonFieldList, StatusBadge } from '@biddaloy/ui/components';
import { useGuardian } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';

import { formatGuardianPhone } from '../-format-guardian-phone';

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
      // Seven label/value pairs, not this route's default table shape —
      // Information is the one guardians tab that renders a `<dl>`.
      skeleton={<SkeletonFieldList fields={7} />}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.loadError')}
    >
      {(guardian) => (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <div>
            <dt className="text-sm text-muted-foreground">{t('detail.information.columnPhone')}</dt>
            <dd>
              {formatGuardianPhone(guardian.phone, regionConfig) ??
                t('detail.information.emptyValue')}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              {t('detail.information.columnAlternatePhone')}
            </dt>
            <dd>
              {formatGuardianPhone(guardian.alternate_phone, regionConfig) ??
                t('detail.information.emptyValue')}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t('detail.information.columnEmail')}</dt>
            {/* `||`, not `??` — a cleared field comes back as `''`, not `null`
                (see `-edit-guardian-dialog.tsx`'s own comment), and both should
                fall back to the empty-state placeholder rather than render blank. */}
            <dd>{guardian.email || t('detail.information.emptyValue')}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              {t('detail.information.columnOccupation')}
            </dt>
            {/* `||`, not `??` — see the email field's own comment above. */}
            <dd>{guardian.occupation || t('detail.information.emptyValue')}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              {t('detail.information.columnAddress')}
            </dt>
            <dd>{guardian.address || t('detail.information.emptyValue')}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              {t('detail.information.columnPreferredCommunication')}
            </dt>
            <dd>{t(`preferredCommunicationOptions.${guardian.preferred_communication}`)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              {t('detail.information.columnPrimaryContact')}
            </dt>
            <dd>
              <StatusBadge
                domain="guardian"
                status={guardian.is_primary_contact ? 'PRIMARY' : 'SECONDARY'}
              />
            </dd>
          </div>
        </dl>
      )}
    </TabQueryState>
  );
}
