import { Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { ChevronRightIcon, CircleCheckIcon } from 'lucide-react';
import * as React from 'react';

import type { SettingsCategoryId } from './settings-categories';

export interface SettingsLayoutProps {
  categories: readonly { id: SettingsCategoryId; label: string; icon: LucideIcon }[];
  /** `undefined` = phone shows the category list. */
  active: SettingsCategoryId | undefined;
  /** What desktop shows when `active` is undefined. */
  fallback: SettingsCategoryId;
  /**
   * The sections of one category. Every category visited so far stays mounted
   * (hidden, not removed), so unsaved form state survives switching category.
   */
  renderPanel: (id: SettingsCategoryId) => React.ReactNode;
}

/** D30: side list of categories on desktop; drill-down list + back link on phone. */
export function SettingsLayout({ categories, active, fallback, renderPanel }: SettingsLayoutProps) {
  const { t } = useTranslation('settings');
  const current = active ?? fallback;
  const [visited, setVisited] = React.useState<readonly SettingsCategoryId[]>([]);
  React.useEffect(() => {
    setVisited((prev) => (prev.includes(current) ? prev : [...prev, current]));
  }, [current]);
  const mounted = visited.includes(current) ? visited : [...visited, current];
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <nav
        aria-label={t('categories.label')}
        className={
          active
            ? 'hidden md:block md:w-56 md:shrink-0'
            : 'rounded-lg border border-border-subtle bg-surface p-1 shadow-e1 md:w-56 md:shrink-0 md:border-0 md:bg-transparent md:p-0 md:shadow-none'
        }
      >
        <ul className="md:space-y-0.5">
          {categories.map((c) => (
            <li key={c.id}>
              <Link
                to="/settings"
                search={{ section: c.id }}
                aria-current={c.id === current ? 'page' : undefined}
                className="flex h-12 items-center gap-2.5 rounded-md px-3 text-text-secondary hover:bg-muted hover:text-text-primary md:h-9 md:aria-[current=page]:bg-secondary md:aria-[current=page]:font-semibold md:aria-[current=page]:text-secondary-foreground"
              >
                <c.icon aria-hidden="true" />
                <span className="truncate">{c.label}</span>
                <ChevronRightIcon aria-hidden="true" className="ms-auto size-4 md:hidden" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1">
        {mounted.map((id) => (
          // `hidden` keeps an inactive panel out of the a11y tree; on phone with no
          // category chosen the current panel is hidden too (the list shows instead).
          <div
            key={id}
            hidden={id !== current}
            className={id === current && !active ? 'hidden space-y-6 md:block' : 'space-y-6'}
          >
            {renderPanel(id)}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface SettingsSectionProps {
  /** DOM id, e.g. 'regional-section'. */
  id?: string;
  title: string;
  description?: string;
  /** E.g. a StatusBadge next to the title. */
  badge?: React.ReactNode;
  /** Omit -> renders a `<section>` with no Save. */
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
  saving?: boolean;
  /** Default `save.action`. */
  saveLabel?: string;
  /** A header action for a card with no Save (e.g. "Add printer"); it is then the card's one primary. */
  actions?: React.ReactNode;
  /** Saved/error message, extra outline buttons (left of Save). */
  footerStart?: React.ReactNode;
  /** Content of the "Advanced" disclosure. */
  advanced?: React.ReactNode;
  advancedSummary?: string;
  /** Force open (e.g. an error inside). */
  advancedOpen?: boolean;
  children: React.ReactNode;
}

/** patterns.md §9: the shared settings card. Owns its `<form noValidate>`; no error summary. */
export function SettingsSection({
  id,
  title,
  description,
  badge,
  onSubmit,
  saving,
  saveLabel,
  actions,
  footerStart,
  advanced,
  advancedSummary,
  advancedOpen,
  children,
}: SettingsSectionProps) {
  const { t } = useTranslation('settings');
  const heading = (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-h2">{title}</h2>
        {badge}
      </div>
      {description && <p className="mt-0.5 text-text-secondary">{description}</p>}
    </>
  );
  // Controlled: an error opens it, and it then stays open until the user closes it.
  const [advancedIsOpen, setAdvancedIsOpen] = React.useState(false);
  React.useEffect(() => {
    if (advancedOpen) setAdvancedIsOpen(true);
  }, [advancedOpen]);
  const className = 'rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5';
  const body = (
    <>
      {actions ? (
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="min-w-0">{heading}</div>
          <div className="flex shrink-0 flex-col gap-2 md:flex-row">{actions}</div>
        </div>
      ) : (
        heading
      )}
      {children}
      {advanced && (
        <details
          className="group/adv mt-4 border-t border-border-subtle pt-2"
          open={advancedIsOpen}
          onToggle={(e) => setAdvancedIsOpen(e.currentTarget.open)}
        >
          <summary className="flex h-11 cursor-pointer list-none items-center gap-1 font-medium text-text-secondary md:h-8">
            <ChevronRightIcon aria-hidden="true" className="size-4 group-open/adv:rotate-90" />
            {advancedSummary ?? t('advanced')}
          </summary>
          {advanced}
        </details>
      )}
      {onSubmit && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">{footerStart}</div>
          <Button type="submit" loading={saving ?? false} className="w-full md:w-auto">
            {saveLabel ?? t('save.action')}
          </Button>
        </div>
      )}
    </>
  );
  return onSubmit ? (
    <form noValidate id={id} onSubmit={onSubmit} className={className}>
      {body}
    </form>
  ) : (
    <section id={id} className={className}>
      {body}
    </section>
  );
}

export function SettingsSaved() {
  const { t } = useTranslation('settings');
  return (
    <p role="status" className="flex items-center gap-1.5 text-text-secondary">
      <CircleCheckIcon aria-hidden="true" className="size-4 text-status-paid-fg" />
      {t('save.success')}
    </p>
  );
}
