/**
 * [32.3.6] Print templates (Administration › Print templates): a school's
 * templates by document type, with default / archive / edit, and creation from
 * the seeded designs (D11, D28, D50, D51). The route (32.4.1) owns navigation
 * (D60), so `onEdit` is a callback.
 *
 * Two things the templates API doesn't return, so they are not shown: the
 * published version NUMBER (only whether one exists) and the last-PUBLISHED date
 * (only when the template was last updated).
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useArchivePrintTemplate,
  useHasPermission,
  usePrintSuggestions,
  usePrintTemplates,
  useSetDefaultPrintTemplate,
  type PrintTemplateRow,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDateTime } from '@biddaloy/ui/utils';
import * as React from 'react';

import { NewTemplateDialog } from './new-template-dialog';
import { SuggestionCard } from './suggestion-card';

export interface PrintTemplateLibraryProps {
  onEdit: (templateId: string) => void;
  /** Open the "New template" dialog straight away (the palette's "New print template"). */
  openNewDialog?: boolean;
}

const PAGE_SIZE_DEFAULT = 10;

/** Student cards first, then staff cards (not alphabetical). */
const KIND_ORDER: Record<string, number> = { STUDENT_ID_CARD: 0, STAFF_ID_CARD: 1 };

/** The server's own message ("Choose another default first"), shown as is. */
const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

function TemplateRowActions({
  template,
  canManage,
  onEdit,
}: {
  template: PrintTemplateRow;
  canManage: boolean;
  onEdit: (id: string) => void;
}) {
  const { t } = useTranslation('printTemplates');
  const makeDefault = useSetDefaultPrintTemplate(template.id);
  const archive = useArchivePrintTemplate(template.id);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const published = template.current_version_id !== null;

  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(template.id)}>
        {t('actions.edit')}
        <span className="sr-only"> {template.name}</span>
      </Button>
      {canManage && published && !template.is_default ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          loading={makeDefault.isPending}
          onClick={() =>
            makeDefault.mutate(undefined, {
              onError: (error) => toast.error(messageOf(error, t('makeDefaultFailed'))),
            })
          }
        >
          {t('actions.makeDefault')}
          <span className="sr-only"> {template.name}</span>
        </Button>
      ) : null}
      {canManage ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmOpen(true)}>
          {t('actions.archive')}
          <span className="sr-only"> {template.name}</span>
        </Button>
      ) : null}

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) archive.reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('archive.title', { name: template.name })}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{t('archive.explain')}</p>
          {archive.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {messageOf(archive.error, t('archive.failed'))}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              {t('archive.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={archive.isPending}
              onClick={() => archive.mutate(undefined, { onSuccess: () => setConfirmOpen(false) })}
            >
              {t('archive.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PrintTemplateLibrary({ onEdit, openNewDialog = false }: PrintTemplateLibraryProps) {
  const { t } = useTranslation('printTemplates');
  const region = useRegionConfig();
  const canManage = useHasPermission(Permission.PRINT_TEMPLATE_MANAGE);
  const templatesQuery = usePrintTemplates();
  const suggestionsQuery = usePrintSuggestions();

  const [kind, setKind] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(PAGE_SIZE_DEFAULT);
  const [newOpen, setNewOpen] = React.useState(openNewDialog);
  const [pickedKey, setPickedKey] = React.useState<string | undefined>(undefined);

  const all = templatesQuery.data ?? [];
  // Grouped by document type (then by name) so each type's templates sit together.
  const rows = all
    .filter((x) => x.archived_at === null && (kind === '' || x.document_kind === kind))
    .sort(
      (a, b) =>
        (KIND_ORDER[a.document_kind] ?? 99) - (KIND_ORDER[b.document_kind] ?? 99) ||
        a.name.localeCompare(b.name),
    );
  const paged = rows.slice((page - 1) * pageSize, page * pageSize);

  function openNew(suggestionKey?: string) {
    setPickedKey(suggestionKey);
    setNewOpen(true);
  }

  // `n` opens "New template" when focus is inside the list (not in a field). Attached to the
  // wrapper with a listener, because a bare div with a key handler isn't valid interactive markup.
  const rootRef = React.useRef<HTMLDivElement>(null);
  const openNewRef = React.useRef(openNew);
  openNewRef.current = openNew;
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || !canManage) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      openNewRef.current();
    }
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [canManage]);

  const columns: DataTableColumn<PrintTemplateRow>[] = [
    { id: 'name', header: t('columns.name'), accessorFn: (row) => row.name, card: 'title' },
    { id: 'type', header: t('columns.type'), accessorFn: (row) => t(`kind.${row.document_kind}`) },
    {
      id: 'status',
      header: t('columns.status'),
      accessorFn: (row) => (row.current_version_id ? t('status.published') : t('status.draft')),
      card: 'badge',
    },
    {
      id: 'default',
      header: t('columns.default'),
      accessorFn: (row) =>
        row.is_default ? (
          <span className="inline-flex rounded-full bg-status-paid-bg px-2 py-0.5 text-xs font-medium text-status-paid-fg">
            {t('default')}
          </span>
        ) : (
          ''
        ),
    },
    { id: 'batch', header: t('columns.batch'), accessorFn: (row) => String(row.batch_size) },
    {
      id: 'updated',
      header: t('columns.updated'),
      accessorFn: (row) => formatDateTime(new Date(row.updated_at), region),
      card: 'subtitle',
    },
    {
      id: 'actions',
      header: t('columns.actions'),
      pinned: true,
      card: 'actions',
      accessorFn: (row) => (
        <TemplateRowActions template={row} canManage={canManage} onEdit={onEdit} />
      ),
    },
  ];

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'kind',
      label: t('filters.kind'),
      allLabel: t('filters.allKinds'),
      options: (['STUDENT_ID_CARD', 'STAFF_ID_CARD'] as const).map((k) => ({
        value: k,
        label: t(`kind.${k}`),
      })),
    },
  ];

  const noTemplatesAtAll = !templatesQuery.isPending && !templatesQuery.isError && all.length === 0;

  const newButton = canManage ? (
    <Button type="button" onClick={() => openNew()}>
      {t('new')}
    </Button>
  ) : undefined;

  return (
    <div ref={rootRef}>
      {noTemplatesAtAll ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-lg font-semibold">{t('title')}</h1>
            {newButton}
          </div>
          <section aria-label={t('empty.heading')} className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">{t('empty.heading')}</h2>
            <p className="text-sm text-muted-foreground">{t('empty.explanation')}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(suggestionsQuery.data ?? []).map((suggestion) => (
                <SuggestionCard
                  key={suggestion.key}
                  suggestion={suggestion}
                  selected={false}
                  onSelect={(key) => canManage && openNew(key)}
                />
              ))}
            </div>
          </section>
        </div>
      ) : (
        <ListShell
          title={t('title')}
          {...(newButton ? { primaryAction: newButton } : {})}
          filters={{
            fields: filterFields,
            values: kind ? { kind } : {},
            onChange: (patch) => {
              setKind(patch.kind ?? '');
              setPage(1);
            },
          }}
          tableId="print-templates-list"
          caption={t('caption')}
          columns={columns}
          data={paged}
          getRowId={(row) => row.id}
          sorting={null}
          onSortingChange={() => undefined}
          page={page}
          pageSize={pageSize}
          totalCount={rows.length}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
          pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
          loading={templatesQuery.isLoading}
          isFetching={templatesQuery.isFetching}
          {...(templatesQuery.isError ? { error: t('loadError') } : {})}
          emptyMessage={t('empty.explanation')}
          announceResults={(count, total) => `${count} / ${total}`}
        />
      )}

      {newOpen ? (
        <NewTemplateDialog
          key={pickedKey ?? 'new'}
          open
          onOpenChange={setNewOpen}
          onCreated={onEdit}
          {...(pickedKey ? { initialSuggestionKey: pickedKey } : {})}
        />
      ) : null}
    </div>
  );
}
