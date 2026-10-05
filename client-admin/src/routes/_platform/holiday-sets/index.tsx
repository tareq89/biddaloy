import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useFetchHolidaySet, useHolidaySets, type PublicHolidaySet } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { ListShell } from '@biddaloy/ui/shells';
import { toLatinDigits } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { CircleAlertIcon, DownloadIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { holidaySetName, SOURCE_LABEL_KEY } from './-holiday-set-name';

/**
 * [17.3.5/#715] SUPER_ADMIN's platform holiday-sets list — every
 * country/year set fetched so far, with a dialog to fetch a new one
 * (`POST /platform/holiday-sets/fetch`). Same "small N, no pagination"
 * call `schools/index.tsx` makes for its own list — the platform runs a
 * handful of country/year combinations, not thousands.
 *
 * [31.4.platform-3] Kit list (D16/D19): header action, translated values,
 * edit row action to `/holiday-sets/$setId`, where entries are edited and
 * the set is published/unpublished.
 */
export const Route = createFileRoute('/_platform/holiday-sets/')({
  loader: () => loadRouteNamespaces('platform'),
  component: HolidaySetsListPage,
});

function HolidaySetsListPage() {
  const { t, i18n } = useTranslation('platform');
  const setsQuery = useHolidaySets();
  const [fetchDialogOpen, setFetchDialogOpen] = React.useState(false);

  const sets = setsQuery.data ?? [];

  const columns: DataTableColumn<PublicHolidaySet>[] = [
    {
      id: 'name',
      header: t('holidaySets.columnName'),
      accessorFn: (row) => (
        <span className="font-medium">{holidaySetName(row, i18n.language, t)}</span>
      ),
      card: 'title',
    },
    {
      id: 'source',
      header: t('holidaySets.columnSource'),
      accessorFn: (row) => t(SOURCE_LABEL_KEY[row.source]),
      card: 'subtitle',
    },
    {
      id: 'entries',
      header: t('holidaySets.columnEntries'),
      // B7: GET /platform/holiday-sets omits `entries` until 31.3.7 — never crash,
      // and never print a made-up 0.
      accessorFn: (row) =>
        row.entries ? t('holidaySets.entryCount', { count: row.entries.length }) : '—',
      align: 'end',
      card: 'subtitle',
    },
    {
      id: 'status',
      header: t('holidaySets.columnPublished'),
      accessorFn: (row) => (
        <StatusBadge
          tone={row.published_at ? 'success' : 'neutral'}
          label={t(row.published_at ? 'holidaySets.published' : 'holidaySets.draft')}
        />
      ),
      card: 'badge',
    },
  ];

  return (
    <>
      <ListShell
        title={t('holidaySets.title')}
        subtitle={t('holidaySets.caption')}
        actions={[
          {
            id: 'fetch',
            label: t('holidaySets.fetchAction'),
            icon: <DownloadIcon aria-hidden="true" />,
            priority: 'primary',
            onClick: () => setFetchDialogOpen(true),
          },
        ]}
        tableId="platform-holiday-sets"
        caption={t('holidaySets.title')}
        columns={columns}
        data={sets}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={() => undefined}
        paginated={false}
        totalCount={sets.length}
        loading={setsQuery.isLoading}
        isFetching={setsQuery.isFetching}
        {...(setsQuery.isError ? { error: t('holidaySets.errorMessage') } : {})}
        rowActions={(row) => [
          {
            intent: 'edit',
            label: t('holidaySets.editAction', { name: holidaySetName(row, i18n.language, t) }),
            to: `/holiday-sets/${row.id}`,
          },
        ]}
        emptyState={{
          title: t('holidaySets.emptyTitle'),
          explanation: t('holidaySets.emptyMessage'),
          action: {
            label: t('holidaySets.fetchAction'),
            onClick: () => setFetchDialogOpen(true),
          },
        }}
      />

      <FetchHolidaySetDialog open={fetchDialogOpen} onOpenChange={setFetchDialogOpen} />
    </>
  );
}

function FetchHolidaySetDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('platform');
  const fetchSet = useFetchHolidaySet();
  const [country, setCountry] = React.useState('');
  const [year, setYear] = React.useState(() => String(new Date().getFullYear()));
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setCountry('');
      setYear(String(new Date().getFullYear()));
      setValidationError(null);
      fetchSet.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized)) {
      setValidationError(t('holidaySets.fetchDialog.countryRequiredError'));
      return;
    }
    // Bangla digits are accepted: normalised to Latin before the range check.
    const yearNumber = Number(toLatinDigits(year.trim()));
    if (!Number.isInteger(yearNumber) || yearNumber < 2000 || yearNumber > 2100) {
      setValidationError(t('holidaySets.fetchDialog.yearError'));
      return;
    }
    setValidationError(null);
    fetchSet.mutate(
      { country: normalized, year: yearNumber },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  // Always the translated sentence — the server's message is never shown (D9).
  const error =
    validationError ?? (fetchSet.isError ? t('holidaySets.fetchDialog.errorMessage') : null);

  return (
    <Dialog
      open={open}
      // A pending request must not be dismissed from under itself.
      onOpenChange={(next) => {
        if (!next && fetchSet.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        size="sm"
        showCloseButton={!fetchSet.isPending}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('holidaySets.fetchDialog.title')}</DialogTitle>
            <DialogDescription>{t('holidaySets.caption')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <label htmlFor="fetch-holiday-set-country" className="text-label font-medium">
              {t('holidaySets.fetchDialog.countryLabel')}
            </label>
            <Input
              id="fetch-holiday-set-country"
              value={country}
              maxLength={2}
              autoCapitalize="characters"
              aria-describedby="fetch-holiday-set-country-help"
              onChange={(event) => setCountry(event.target.value)}
            />
            <p id="fetch-holiday-set-country-help" className="text-caption text-text-secondary">
              {t('holidaySets.fetchDialog.countryHelp')}
            </p>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="fetch-holiday-set-year" className="text-label font-medium">
              {t('holidaySets.fetchDialog.yearLabel')}
            </label>
            <Input
              id="fetch-holiday-set-year"
              inputMode="numeric"
              value={year}
              onChange={(event) => setYear(event.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
              <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={fetchSet.isPending}>
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={fetchSet.isPending}>
              {fetchSet.isPending
                ? t('holidaySets.fetchDialog.fetching')
                : t('holidaySets.fetchDialog.submitAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
