/** [69.5.01] D16: no student has a result, so the marks filter is hidden and only ticks remain. */
import { EmptyState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

export function NoSourceNotice() {
  const { t } = useTranslation('promotions');
  return <EmptyState title={t('groups.noSourceTitle')} explanation={t('groups.noSourceBody')} />;
}
