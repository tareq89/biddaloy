/**
 * [48.3.D-01] "To print": what is still waiting, grouped so one click prints a group (D5, D34). Not a
 * single table, so no `ListShell`: the page header, the tabs and a filter bar are laid out here.
 * Admit cards come first (one card per exam, nearest exam first, as the server orders them).
 */
import { EmptyState, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useIdCardQueue, usePrintQueue } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import {
  FilterBar,
  PageContainer,
  PageHeader,
  type FilterFieldDescriptor,
} from '@biddaloy/ui/shells';
import { PrinterIcon } from 'lucide-react';
import * as React from 'react';
import type { ReactNode } from 'react';

import { ExamGroup, IdCardGroup } from './to-print-cards';

export function ToPrint({ tabs }: { tabs: ReactNode }) {
  const { t } = useTranslation('printHistory');
  const queue = usePrintQueue();
  const idCards = useIdCardQueue({ limit: 100 });
  const [filters, setFilters] = React.useState<Record<string, string>>({});

  const exams = queue.data?.exams ?? [];
  const idRows = idCards.data?.data ?? [];
  const classes = [
    ...new Set([...exams.map((e) => e.class_name), ...idRows.map((r) => r.class_name ?? '')]),
  ].filter(Boolean);

  const showAdmit = filters.kind !== 'ID';
  const showId = filters.kind !== 'ADMIT';
  const shownExams = showAdmit
    ? exams.filter((e) => !filters.class || e.class_name === filters.class)
    : [];
  const shownIds = showId
    ? idRows.filter((r) => !filters.class || r.class_name === filters.class)
    : [];

  const fields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'kind',
      label: t('filters.kind'),
      allLabel: t('filters.allKinds'),
      options: [
        { value: 'ADMIT', label: t('toPrint.admitCards') },
        { value: 'ID', label: t('toPrint.idCards') },
      ],
    },
    {
      kind: 'select',
      key: 'class',
      label: t('toPrint.classLabel'),
      allLabel: t('toPrint.allClasses'),
      options: classes.map((c) => ({ value: c, label: c })),
    },
  ];

  const loading = queue.isPending || idCards.isPending;
  const failed = queue.isError || idCards.isError;
  const nothing = !loading && !failed && (queue.data?.total ?? 0) === 0 && idRows.length === 0;
  const total = queue.data?.total ?? 0;

  return (
    <PageContainer size="wide">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {tabs}
      {failed ? (
        <ErrorState
          message={t('loadError')}
          onRetry={() => {
            void queue.refetch();
            void idCards.refetch();
          }}
        />
      ) : loading ? (
        <Skeleton className="h-40 w-full" aria-busy="true" />
      ) : nothing ? (
        <EmptyState
          title={t('toPrint.empty')}
          explanation={t('toPrint.emptyExplanation')}
          icon={<PrinterIcon aria-hidden className="size-5" />}
        />
      ) : (
        <>
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <FilterBar
              fields={fields}
              values={filters}
              onChange={(patch) =>
                setFilters((prev) => {
                  const next = { ...prev };
                  for (const [k, v] of Object.entries(patch)) {
                    if (v === null || v === '') delete next[k];
                    else next[k] = v;
                  }
                  return next;
                })
              }
            />
            <p className="text-text-secondary">{t('toPrint.summary', { count: total })}</p>
          </div>
          {shownExams.length > 0 ? (
            <section className="flex flex-col gap-3" aria-labelledby="to-print-admit">
              <h2 id="to-print-admit" className="text-h2">
                {t('toPrint.admitCards')}
              </h2>
              {shownExams.map((exam, i) => (
                <ExamGroup key={exam.exam_id} exam={exam} filled={i === 0} />
              ))}
            </section>
          ) : null}
          {shownIds.length > 0 ? (
            <section className="flex flex-col gap-3" aria-labelledby="to-print-id">
              <h2 id="to-print-id" className="text-h2">
                {t('toPrint.idCards')}
              </h2>
              <IdCardGroup filled={shownExams.length === 0} rows={shownIds} />
            </section>
          ) : null}
        </>
      )}
    </PageContainer>
  );
}
