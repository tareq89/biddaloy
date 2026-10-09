/**
 * [8.11.10]'s field-level before/after diff — the panel a row expands
 * into.
 *
 * Two acceptance criteria drive the design:
 *
 *  - **Changed fields are marked with text *and* colour, never colour
 *    alone.** Every changed row carries a literal "Changed" marker plus a
 *    bold weight; the colour is the third signal, not the only one, so a
 *    colour-blind reader or a monochrome printout loses nothing.
 *  - **Plain language, not raw JSON.** Values go through `-humanize.ts`
 *    before they reach the DOM — booleans become Yes/No, dates format to
 *    the tenant's region config, `null` becomes an em dash, and a
 *    one-level nested object flattens to "Label: value" lines.
 *
 * Unchanged fields are collapsed behind a disclosure button. An UPDATE
 * snapshot usually carries the entity's whole row, so showing all of it
 * would bury the two fields that actually changed.
 */
import {
  Button,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronUp } from 'lucide-react';
import * as React from 'react';

import {
  diffFields,
  humanizeFieldName,
  humanizeValue,
  isEventOnly,
  type DiffField,
  type HumanizeOptions,
} from './-humanize';

const PHONE_QUERY = '(max-width: 767px)';

/** Below `md` the 3-column table squeezes every value; the phone layout
 * stacks "Before / After" lines instead. Only one layout is mounted, so
 * the two never share accessible names. */
function subscribePhone(onChange: () => void) {
  if (typeof matchMedia !== 'function') return () => undefined;
  const mql = matchMedia(PHONE_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}
function usePhone(): boolean {
  return React.useSyncExternalStore(
    subscribePhone,
    () => typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

export interface DiffPanelProps {
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  /**
   * The audit row's `entity_type` (e.g. `'Enrollment'`). Optional — most
   * callers (and every pre-[15.2.6] test) don't need it, since the diff
   * renders identically for every entity type by default. It only
   * changes behavior for `'Enrollment'`: `student_id`/`class_id` render
   * as links to the record they name, per [15.2.6] — an enrollment row
   * carries only ids in its metadata, and an id alone isn't something an
   * administrator resolving a dispute can act on.
   */
  entityType?: string;
}

/** A field worth linking to the record it names, plus where. */
type FieldLink =
  | { to: '/students/$studentId'; params: { studentId: string } }
  | { to: '/classes/$classId'; params: { classId: string } };

/**
 * A field/value pair worth linking to another page, and where. Only
 * covers metadata keys a route actually exists for — `section_id` has no
 * detail route of its own (a section is shown nested under its class), so
 * it stays plain text.
 */
function linkFor(entityType: string | undefined, key: string, value: unknown): FieldLink | null {
  if (entityType !== 'Enrollment' || typeof value !== 'string' || value === '') return null;
  if (key === 'student_id') return { to: '/students/$studentId', params: { studentId: value } };
  if (key === 'class_id') return { to: '/classes/$classId', params: { classId: value } };
  return null;
}

function ValueLines({ lines, link }: { lines: string[]; link: FieldLink | null }) {
  return (
    <>
      {lines.map((line, index) =>
        link && index === 0 ? (
          <Link
            key={`${line}-${String(index)}`}
            to={link.to}
            params={link.params}
            className="block break-words text-primary underline underline-offset-2"
          >
            {line}
          </Link>
        ) : (
          <span key={`${line}-${String(index)}`} className="block break-words">
            {line}
          </span>
        ),
      )}
    </>
  );
}

/** One "Before: x" / "After: x" line on phone. A linked value keeps its link. */
function InlineValue({
  label,
  inline,
  lines,
  link,
}: {
  label: string;
  inline: string;
  lines: string[];
  link: FieldLink | null;
}) {
  if (!link) return <>{inline}</>;
  return (
    <>
      <span>{label}: </span>
      <ValueLines lines={lines} link={link} />
    </>
  );
}

export function DiffPanel({ oldValues, newValues, entityType }: DiffPanelProps) {
  const { t } = useTranslation('auditLogs');
  const config = useRegionConfig();
  const phone = usePhone();
  const [showUnchanged, setShowUnchanged] = React.useState(false);

  const fields = diffFields(oldValues, newValues);
  const changed = fields.filter((field) => field.changed);
  const unchanged = fields.filter((field) => !field.changed);

  // A per-key lookup into the `fields` namespace map, with i18next's own
  // `defaultValue` as the fallback rather than an `i18n.exists` probe:
  // the snapshot keys are arbitrary server column names, so most of them
  // will never have a translation, and a missing one has to degrade to a
  // sentence-cased label rather than a raw key path.
  const fieldLabel = React.useCallback(
    (key: string) => t(`fields.${key}`, { defaultValue: humanizeFieldName(key) }),
    [t],
  );

  const humanizeOptions: HumanizeOptions = {
    config,
    emptyValue: t('diff.emptyValue'),
    trueLabel: t('diff.yes'),
    falseLabel: t('diff.no'),
    fieldLabel,
  };

  if (isEventOnly(oldValues, newValues)) {
    return <p className="text-body text-text-secondary">{t('diff.noChanges')}</p>;
  }

  const visible: DiffField[] = showUnchanged ? [...changed, ...unchanged] : changed;
  // Text marker first, colour second — the "never colour alone" rule.
  const marker = (field: DiffField) => (
    <span
      className={
        field.changed
          ? 'text-caption font-semibold text-primary'
          : 'text-caption text-text-secondary'
      }
    >
      {field.changed ? t('diff.changed') : t('diff.unchanged')}
    </span>
  );

  return (
    <div className="flex flex-col gap-2">
      {phone ? (
        <>
          <p className="text-label text-text-secondary">{t('diff.title')}</p>
          <dl className="space-y-3">
            {visible.map((field) => {
              const beforeLines = humanizeValue(field.before, humanizeOptions);
              const afterLines = humanizeValue(field.after, humanizeOptions);
              return (
                <div key={field.key}>
                  <dt className="font-medium">
                    {fieldLabel(field.key)} {marker(field)}
                  </dt>
                  <dd className="text-text-secondary">
                    <InlineValue
                      label={t('diff.columnBefore')}
                      inline={t('diff.beforeInline', { value: beforeLines.join(', ') })}
                      lines={beforeLines}
                      link={linkFor(entityType, field.key, field.before)}
                    />
                  </dd>
                  <dd className={field.changed ? 'font-semibold text-primary' : undefined}>
                    <InlineValue
                      label={t('diff.columnAfter')}
                      inline={t('diff.afterInline', { value: afterLines.join(', ') })}
                      lines={afterLines}
                      link={linkFor(entityType, field.key, field.after)}
                    />
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      ) : (
        <Table>
          <TableCaption className="pb-2 text-start text-label text-text-secondary">
            {t('diff.title')}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 text-caption font-medium text-text-secondary">
                {t('diff.columnField')}
              </TableHead>
              <TableHead className="h-8 text-caption font-medium text-text-secondary">
                {t('diff.columnBefore')}
              </TableHead>
              <TableHead className="h-8 text-caption font-medium text-text-secondary">
                {t('diff.columnAfter')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-border-subtle">
            {visible.map((field) => (
              <TableRow key={field.key}>
                <TableCell className="h-9 pe-4">
                  <span className="font-medium">{fieldLabel(field.key)}</span> {marker(field)}
                </TableCell>
                <TableCell className={field.changed ? 'h-9 pe-4 text-text-secondary' : 'h-9 pe-4'}>
                  <ValueLines
                    lines={humanizeValue(field.before, humanizeOptions)}
                    link={linkFor(entityType, field.key, field.before)}
                  />
                </TableCell>
                <TableCell
                  className={field.changed ? 'h-9 pe-4 font-semibold text-primary' : 'h-9 pe-4'}
                >
                  <ValueLines
                    lines={humanizeValue(field.after, humanizeOptions)}
                    link={linkFor(entityType, field.key, field.after)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* An UPDATE whose snapshots turn out identical: a header-only table
          with no rows reads as broken. */}
      {visible.length === 0 && (
        <p className="text-body text-text-secondary">{t('diff.noFieldsChanged')}</p>
      )}

      {unchanged.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="inline-flex h-11 items-center gap-1 self-start rounded-md px-2 text-label font-medium text-primary md:h-8"
          aria-expanded={showUnchanged}
          onClick={() => setShowUnchanged((previous) => !previous)}
        >
          {showUnchanged ? (
            <ChevronUp aria-hidden className="size-4" />
          ) : (
            <ChevronDown aria-hidden className="size-4" />
          )}
          {showUnchanged
            ? t('diff.hideUnchanged', {
                count: unchanged.length,
                n: formatNumber(unchanged.length, config),
              })
            : t('diff.showUnchanged', {
                count: unchanged.length,
                n: formatNumber(unchanged.length, config),
              })}
        </Button>
      )}
    </div>
  );
}
