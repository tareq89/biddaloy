/**
 * #3886 The plans list: name, price per seat per month, on/off. The default plan has no switch (D26).
 * Presentational: the route owns the hooks and the dialog. Plans are switched off, never deleted.
 */
import { Button, DataTable, Switch, type DataTableColumn } from '@biddaloy/ui/components';
import type { PlatformPlan } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency } from '@biddaloy/ui/utils';

export interface PlanListViewProps {
  plans: PlatformPlan[];
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
  onNew: () => void;
  onEdit: (plan: PlatformPlan) => void;
  onToggle: (plan: PlatformPlan, active: boolean) => void;
  /** Id of the plan whose switch is saving. */
  busyId?: string | undefined;
  switchError?: boolean;
}

export function PlanListView(props: PlanListViewProps) {
  const { plans, loading, error, onRetry, onNew, onEdit, onToggle } = props;
  const { t } = useTranslation('moneyPlans');
  const config = useRegionConfig();

  const columns: DataTableColumn<PlatformPlan>[] = [
    { id: 'name', header: t('list.name'), accessorFn: (r) => r.name, card: 'title' },
    {
      id: 'price',
      header: t('list.price'),
      accessorFn: (r) => formatCurrency(r.unit_price_paisa, config),
      align: 'end',
    },
    {
      id: 'active',
      header: t('list.status'),
      accessorFn: (r) =>
        r.is_default ? (
          <span title={t('list.defaultNote')} className="text-caption font-medium">
            {t('list.default')}
          </span>
        ) : (
          <Switch
            checked={r.active}
            disabled={props.busyId === r.id}
            aria-label={t('list.switch', { name: r.name })}
            onCheckedChange={(next) => onToggle(r, next)}
          />
        ),
    },
  ];

  return (
    <section aria-labelledby="plans-title" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="plans-title" className="text-heading-3 font-semibold">
          {t('title')}
        </h2>
        <Button type="button" className="min-h-11 md:min-h-0" onClick={onNew}>
          {t('new')}
        </Button>
      </div>
      <p className="text-caption text-text-secondary">{t('note')}</p>
      <p className="text-caption text-text-secondary">{t('list.keepNote')}</p>
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
          tableId="money-plans"
          caption={t('list.caption')}
          columns={columns}
          data={plans}
          getRowId={(r) => r.id}
          sorting={null}
          onSortingChange={() => undefined}
          totalCount={plans.length}
          paginated={false}
          loading={loading ?? false}
          emptyState={{ title: t('empty.title'), explanation: t('empty.description') }}
          rowActions={(row) => [
            { intent: 'edit', label: t('list.edit'), onClick: () => onEdit(row) },
          ]}
        />
      )}
    </section>
  );
}
