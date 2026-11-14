/**
 * #3887 The coupons list: code, discount, first N months, uses, expiry, on/off. Presentational:
 * the route owns the hooks and the dialogs. Coupons are switched off, never deleted, so an off
 * coupon stays in the list with its switch off.
 */
import { Button, DataTable, Switch, type DataTableColumn } from '@biddaloy/ui/components';
import type { PlatformCoupon } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatDate } from '@biddaloy/ui/utils';

export interface CouponListViewProps {
  coupons: PlatformCoupon[];
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
  onNew: () => void;
  onEdit: (coupon: PlatformCoupon) => void;
  onUsage: (coupon: PlatformCoupon) => void;
  onToggle: (coupon: PlatformCoupon, active: boolean) => void;
  /** Id of the coupon whose switch is saving. */
  busyId?: string | undefined;
  switchError?: boolean;
}

export function CouponListView(props: CouponListViewProps) {
  const { coupons, loading, error, onRetry, onNew, onEdit, onUsage, onToggle } = props;
  const { t } = useTranslation('moneyCoupons');
  const config = useRegionConfig();

  const columns: DataTableColumn<PlatformCoupon>[] = [
    { id: 'code', header: t('list.code'), accessorFn: (r) => r.code.toUpperCase(), card: 'title' },
    {
      id: 'discount',
      header: t('list.discount'),
      accessorFn: (r) =>
        r.discount_kind === 'PERCENT'
          ? t('list.percent', { n: r.percent ?? 0 })
          : t('list.fixed', { amount: formatCurrency(r.fixed_paisa ?? 0, config) }),
    },
    {
      id: 'months',
      header: t('list.months'),
      accessorFn: (r) =>
        r.max_months ? t('list.monthsValue', { n: r.max_months }) : t('list.allMonths'),
    },
    {
      id: 'uses',
      header: t('list.uses'),
      accessorFn: (r) =>
        r.max_uses === null
          ? String(r.uses_count)
          : t('list.usesOf', { used: r.uses_count, max: r.max_uses }),
      align: 'end',
    },
    { id: 'expiry', header: t('list.expiry'), accessorFn: (r) => formatDate(r.ends_at, config) },
    {
      id: 'active',
      header: t('list.status'),
      accessorFn: (r) => (
        <span className="flex items-center gap-2">
          <Switch
            checked={r.active}
            disabled={props.busyId === r.id}
            aria-label={t('list.switch', { code: r.code.toUpperCase() })}
            onCheckedChange={(next) => onToggle(r, next)}
          />
          {/* Visible, not title-only: touch and screen-reader users read the state too. */}
          {!r.active && <span className="text-caption text-text-secondary">{t('list.off')}</span>}
        </span>
      ),
    },
  ];

  return (
    <section aria-labelledby="coupons-title" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="coupons-title" className="text-heading-3 font-semibold">
          {t('title')}
        </h2>
        <Button type="button" className="min-h-11 md:min-h-0" onClick={onNew}>
          {t('new')}
        </Button>
      </div>
      <p className="text-caption text-text-secondary">{t('note')}</p>
      {props.switchError && (
        <p role="alert" className="text-caption text-destructive">
          {t('list.switchError')}
        </p>
      )}
      {error ? (
        <div role="alert" className="flex items-center gap-3 text-destructive">
          <span>{t('loadError')}</span>
          <Button type="button" variant="outline" onClick={onRetry}>
            {t('retry')}
          </Button>
        </div>
      ) : (
        <DataTable
          tableId="money-coupons"
          caption={t('list.caption')}
          columns={columns}
          data={coupons}
          getRowId={(r) => r.id}
          sorting={null}
          onSortingChange={() => undefined}
          totalCount={coupons.length}
          paginated={false}
          loading={loading ?? false}
          emptyState={{ title: t('empty.title'), explanation: t('empty.description') }}
          rowActions={(row) => [
            { intent: 'view', label: t('list.usage'), onClick: () => onUsage(row) },
            { intent: 'edit', label: t('list.edit'), onClick: () => onEdit(row) },
          ]}
        />
      )}
    </section>
  );
}
