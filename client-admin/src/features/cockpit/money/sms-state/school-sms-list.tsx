import { Button, type DataTableColumn, DataTable } from '@biddaloy/ui/components';
import type { SmsStateSchoolRow } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';

export interface SchoolSmsListProps {
  schools: SmsStateSchoolRow[];
  /** Cards on a phone, a table on a desktop; `auto` measures the table's own width. */
  layout?: 'auto' | 'table' | 'cards';
  /** Opens that school's billing detail (`/subscriptions`, D13). */
  onOpen: (school: SmsStateSchoolRow) => void;
}

/** SMS the school still holds: bought, minus used, minus expired. Never below zero. */
export const smsLeft = (s: SmsStateSchoolRow) => Math.max(0, s.soldSms - s.usedSms - s.expiredSms);

/** Worst first: the school with the least left is the one to call. */
export const worstFirst = (rows: SmsStateSchoolRow[]) =>
  [...rows].sort((a, b) => smsLeft(a) - smsLeft(b) || a.schoolName.localeCompare(b.schoolName));

export function SchoolSmsList({ schools, layout = 'auto', onOpen }: SchoolSmsListProps) {
  const { t } = useTranslation('money');
  const config = useRegionConfig();
  const n = (v: number) => formatNumber(v, config);

  const columns: DataTableColumn<SmsStateSchoolRow>[] = [
    {
      id: 'school',
      header: t('sms.columnSchool'),
      accessorFn: (row) => <span className="font-medium">{row.schoolName}</span>,
      card: 'title',
    },
    {
      id: 'sold',
      header: t('sms.columnSold'),
      accessorFn: (r) => n(r.soldSms),
      align: 'end',
      card: 'field',
    },
    {
      id: 'used',
      header: t('sms.columnUsed'),
      accessorFn: (r) => n(r.usedSms),
      align: 'end',
      card: 'field',
    },
    {
      id: 'left',
      header: t('sms.columnLeft'),
      accessorFn: (r) => n(smsLeft(r)),
      align: 'end',
      card: 'field',
    },
    {
      id: 'failed',
      header: t('sms.columnFailed'),
      accessorFn: (r) =>
        r.failureRateBp === null
          ? '—'
          : formatNumber(r.failureRateBp / 100, config, { percent: true, decimals: 1 }),
      align: 'end',
      card: 'field',
    },
    {
      id: 'open',
      header: '',
      accessorFn: (r) => (
        <Button
          variant="outline"
          className="min-h-11 md:min-h-0"
          aria-label={t('sms.openSchool', { name: r.schoolName })}
          onClick={() => onOpen(r)}
        >
          {t('sms.columnOpen')}
        </Button>
      ),
      card: 'actions',
    },
  ];

  return (
    <DataTable
      tableId="platform-money-sms-schools"
      caption={t('sms.schoolsCaption')}
      columns={columns}
      data={worstFirst(schools)}
      getRowId={(r) => r.schoolId}
      totalCount={schools.length}
      paginated={false}
      sorting={null}
      onSortingChange={() => {}}
      layout={layout}
    />
  );
}
