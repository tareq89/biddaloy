import { ApiError } from '@biddaloy/ui/api';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useFetchHolidaySet, useHolidaySets, type PublicHolidaySet } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

/**
 * [17.3.5/#715] SUPER_ADMIN's platform holiday-sets list — every
 * country/year set fetched so far, with a dialog to fetch a new one
 * (`POST /platform/holiday-sets/fetch`). Same "small N, no pagination"
 * call `schools/index.tsx` makes for its own list — the platform runs a
 * handful of country/year combinations, not thousands.
 *
 * Row click navigates to `/holiday-sets/$setId`, where entries are
 * edited and the set is published/unpublished.
 */
export const Route = createFileRoute('/_platform/holiday-sets/')({
  loader: () => loadRouteNamespaces('platform'),
  component: HolidaySetsListPage,
});

function HolidaySetsListPage() {
  const { t } = useTranslation('platform');
  const setsQuery = useHolidaySets();
  const [fetchDialogOpen, setFetchDialogOpen] = React.useState(false);

  const sets = setsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{t('holidaySets.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('holidaySets.caption')}</p>
        </div>
        <Button type="button" onClick={() => setFetchDialogOpen(true)}>
          {t('holidaySets.fetchAction')}
        </Button>
      </div>

      {setsQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('holidaySets.errorMessage')}
        </p>
      )}

      {!setsQuery.isError && setsQuery.isLoading && (
        <p className="text-sm text-muted-foreground">{t('holidaySets.title')}…</p>
      )}

      {!setsQuery.isLoading && !setsQuery.isError && sets.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('holidaySets.emptyMessage')}</p>
      )}

      {sets.length > 0 && (
        <Table aria-label={t('holidaySets.title')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('holidaySets.columnCountry')}</TableHead>
              <TableHead>{t('holidaySets.columnYear')}</TableHead>
              <TableHead>{t('holidaySets.columnSource')}</TableHead>
              <TableHead>{t('holidaySets.columnEntries')}</TableHead>
              <TableHead>{t('holidaySets.columnPublished')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sets.map((set) => (
              <TableRow key={set.id}>
                <TableCell>
                  <Link
                    to="/holiday-sets/$setId"
                    params={{ setId: set.id }}
                    className="font-medium text-primary underline"
                  >
                    {set.country}
                  </Link>
                </TableCell>
                <TableCell>{set.year}</TableCell>
                <TableCell>{set.source}</TableCell>
                <TableCell>{set.entries.length}</TableCell>
                <TableCell>
                  <PublishedPill set={set} t={t} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <FetchHolidaySetDialog open={fetchDialogOpen} onOpenChange={setFetchDialogOpen} />
    </div>
  );
}

/** No `StatusBadge` domain fits "published/draft" cleanly without
 * touching that shared component outside this ticket's territory — a
 * small inline pill reusing the same tone tokens/icon-plus-text
 * convention instead. */
function PublishedPill({ set, t }: { set: PublicHolidaySet; t: (key: string) => string }) {
  const published = set.published_at !== null;
  return (
    <span
      className={
        published
          ? 'inline-flex items-center rounded-full bg-status-paid-bg px-2 py-0.5 text-xs font-medium text-status-paid-fg'
          : 'inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
      }
    >
      {published ? t('holidaySets.published') : t('holidaySets.draft')}
    </span>
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
  const [year, setYear] = React.useState(() => new Date().getFullYear());
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setCountry('');
      setYear(new Date().getFullYear());
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
    setValidationError(null);
    fetchSet.mutate({ country: normalized, year }, { onSuccess: () => onOpenChange(false) });
  }

  const serverError =
    fetchSet.isError &&
    (fetchSet.error instanceof ApiError
      ? fetchSet.error.message
      : t('holidaySets.fetchDialog.errorMessage'));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('holidaySets.fetchDialog.title')}</DialogTitle>
            <DialogDescription>{t('holidaySets.caption')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="fetch-holiday-set-country" className="text-sm font-medium">
              {t('holidaySets.fetchDialog.countryLabel')}
            </label>
            <Input
              id="fetch-holiday-set-country"
              value={country}
              maxLength={2}
              onChange={(event) => setCountry(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="fetch-holiday-set-year" className="text-sm font-medium">
              {t('holidaySets.fetchDialog.yearLabel')}
            </label>
            <Input
              id="fetch-holiday-set-year"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            />
          </div>

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {!validationError && serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
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
