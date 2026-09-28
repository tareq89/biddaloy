/**
 * [38.4.3] Shared "Fines | Rules" tab bar for both `index.tsx` and
 * `rules.tsx` — was duplicated identically in both files, pulled out here.
 */
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';

export function FinesTabs() {
  const { t } = useTranslation('fines');
  return (
    <div className="mb-4 flex gap-4 border-b">
      <Link
        to="/fees/fines"
        activeOptions={{ exact: true }}
        className="border-b-2 border-transparent px-1 pb-2 text-sm font-medium text-muted-foreground [&.active]:border-primary [&.active]:text-foreground"
        activeProps={{ className: 'active' }}
      >
        {t('tabs.fines')}
      </Link>
      <Link
        to="/fees/fines/rules"
        className="border-b-2 border-transparent px-1 pb-2 text-sm font-medium text-muted-foreground [&.active]:border-primary [&.active]:text-foreground"
        activeProps={{ className: 'active' }}
      >
        {t('tabs.rules')}
      </Link>
    </div>
  );
}
