import { Tabs, TabsList, TabsTrigger } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';

/** D13: one URL per tab. The order is the owner's reading order. */
export const MONEY_TABS = [
  { id: 'sms', to: '/money' },
  { id: 'packages', to: '/money/packages' },
  { id: 'plans', to: '/money/plans' },
  { id: 'coupons', to: '/money/coupons' },
  { id: 'revenue', to: '/money/revenue' },
] as const;

export type MoneyTabId = (typeof MONEY_TABS)[number]['id'];

/** The tab for a pathname: `/money/plans` is `plans`, anything else under money is `sms`. */
export function moneyTabOf(pathname: string): MoneyTabId {
  const last = pathname.replace(/\/+$/, '').split('/').pop();
  return MONEY_TABS.find((tab) => tab.id === last)?.id ?? 'sms';
}

export function MoneyTabs({ active }: { active: MoneyTabId }) {
  const { t } = useTranslation('money');
  return (
    <Tabs value={active}>
      <TabsList variant="line" aria-label={t('tabsLabel')}>
        {MONEY_TABS.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id} asChild className="min-h-11 md:min-h-0">
            {/* ponytail: the other tab routes land in later tickets, so `to` is not in the route union yet. */}
            <Link to={tab.to as never} aria-current={tab.id === active ? 'page' : undefined}>
              {t(`tabs.${tab.id}`)}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
