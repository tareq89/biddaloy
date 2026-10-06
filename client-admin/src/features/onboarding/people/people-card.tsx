import { Button, Card } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import { DownloadIcon } from 'lucide-react';
import type * as React from 'react';

export interface PeopleCardProps {
  title: string;
  /** Already-translated "N added" line. */
  count: string;
  note?: string;
  byHand: { to: string; search?: Record<string, unknown> };
  excel: { to: string };
  onDownloadSample?: (() => void) | undefined;
}

/**
 * ponytail: the cast below turns off route type-checking for every link here.
 * Every target reads `?from=welcome` via `useSearch({ strict: false })` to offer
 * "Back to setup", but none declares it in its search schema; declare it per
 * route and type `to` if this ever needs real checking.
 */
export function WelcomeLink({
  to,
  search,
  children,
  className,
}: {
  to: string;
  search?: Record<string, unknown> | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  const props = { to, search: { ...search, from: 'welcome' } } as unknown as React.ComponentProps<
    typeof Link
  >;
  return (
    <Link {...props} {...(className ? { className } : {})}>
      {children}
    </Link>
  );
}

/** [13.6.4] One "add people" card: by hand, by Excel, sample file. */
export function PeopleCard({
  title,
  count,
  note,
  byHand,
  excel,
  onDownloadSample,
}: PeopleCardProps) {
  const { t } = useTranslation('onboardingPeople');
  return (
    <Card padded className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{count}</p>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </div>
      <div className="flex flex-col gap-2 md:flex-row">
        <Button asChild variant="outline" className="w-full md:w-auto">
          <WelcomeLink to={byHand.to} search={byHand.search}>
            {t('byHand')}
          </WelcomeLink>
        </Button>
        <Button asChild variant="outline" className="w-full md:w-auto">
          <WelcomeLink to={excel.to}>{t('uploadExcel')}</WelcomeLink>
        </Button>
        {onDownloadSample && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 md:min-h-0"
            onClick={onDownloadSample}
          >
            <DownloadIcon aria-hidden className="size-4" />
            {t('downloadSample')}
          </Button>
        )}
      </div>
    </Card>
  );
}
