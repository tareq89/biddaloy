/**
 * #3887 Coupon usage: uses, total discount in taka, and a per-school table. Opens as a dialog
 * (full width on a phone). A cancel or a refund never gives a use back (D25).
 */
import {
  Button,
  DataTable,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useCouponUsage, type CouponUsage as Usage, type PlatformCoupon } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency } from '@biddaloy/ui/utils';

type SchoolRow = Usage['schools']['items'][number];

export interface CouponUsageProps {
  coupon: PlatformCoupon | undefined;
  onOpenChange: (open: boolean) => void;
}

export function CouponUsage({ coupon, onOpenChange }: CouponUsageProps) {
  const { t } = useTranslation('moneyCoupons');
  const config = useRegionConfig();
  const query = useCouponUsage(coupon?.id);
  const code = coupon?.code.toUpperCase() ?? '';
  const taka = (paisa: string) => formatCurrency(Number(paisa), config);

  const columns: DataTableColumn<SchoolRow>[] = [
    { id: 'school', header: t('usage.school'), accessorFn: (r) => r.schoolName, card: 'title' },
    { id: 'uses', header: t('usage.schoolUses'), accessorFn: (r) => r.uses, align: 'end' },
    {
      id: 'discount',
      header: t('usage.schoolTotal'),
      accessorFn: (r) => taka(r.discountPaisa),
      align: 'end',
    },
  ];

  return (
    <Dialog open={coupon !== undefined} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-dvh overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('usage.title', { code })}</DialogTitle>
          <DialogDescription>{t('usage.description')}</DialogDescription>
        </DialogHeader>
        {query.isError ? (
          <div role="alert" className="flex items-center gap-3 text-destructive">
            <span>{t('usage.error')}</span>
            <Button type="button" variant="outline" onClick={() => void query.refetch()}>
              {t('retry')}
            </Button>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-caption text-text-secondary">{t('usage.uses')}</dt>
                <dd className="text-heading-3 font-semibold">{query.data?.uses ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-caption text-text-secondary">{t('usage.total')}</dt>
                <dd className="text-heading-3 font-semibold">
                  {query.data ? taka(query.data.totalDiscountPaisa) : '—'}
                </dd>
              </div>
            </dl>
            <h3 className="text-heading-4 font-semibold">{t('usage.perSchool')}</h3>
            <DataTable
              tableId="money-coupon-usage"
              caption={t('usage.perSchool')}
              columns={columns}
              data={query.data?.schools.items ?? []}
              getRowId={(r) => r.schoolId}
              sorting={null}
              onSortingChange={() => undefined}
              totalCount={query.data?.schools.items.length ?? 0}
              paginated={false}
              loading={query.isLoading}
              emptyState={{ title: t('usage.empty'), explanation: t('usage.emptyNote') }}
            />
          </>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('usage.close')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
