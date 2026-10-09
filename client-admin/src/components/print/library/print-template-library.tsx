/**
 * [32.3.6] Print designs (Administration › Print designs): a school's designs
 * by document type, with default / archive / edit, and creation from the seeded
 * designs (D11, D28, D50, D51). The route (32.4.1) owns navigation (D60), so
 * `onEdit` is a callback.
 *
 * Two things the templates API doesn't return, so they are not shown: the
 * published version NUMBER (only whether one exists) and the last-PUBLISHED date
 * (only when the template was last updated).
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Card,
  ConfirmDialog,
  StatusBadge,
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
import { ListShell, PageHeader, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { PlusIcon, StarIcon } from 'lucide-react';
import * as React from 'react';

import { NewTemplateDialog } from './new-template-dialog';
import { SuggestionCard } from './suggestion-card';

export interface PrintTemplateLibraryProps {
  onEdit: (templateId: string) => void;
  /** Open the "New design" dialog straight away (the palette's "New print template"). */
  openNewDialog?: boolean;
}

/** Student cards first, then staff cards, then ACR pages (not alphabetical). */
const KIND_ORDER: Record<string, number> = {
  STUDENT_ID_CARD: 0,
  STAFF_ID_CARD: 1,
  ACR_ASSESSMENT: 2,
};

/** Each confirm owns its mutation hook, which takes the template id at hook time. */
function ArchiveConfirm({
  template,
  onClose,
}: {
  template: PrintTemplateRow;
  onClose: () => void;
}) {
  const { t } = useTranslation('printTemplates');
  const archive = useArchivePrintTemplate(template.id);
  return (
    <ConfirmDialog
      open
      tone="default"
      onOpenChange={(open) => {
        if (!open && !archive.isPending) onClose();
      }}
      title={t('archive.title', { name: template.name })}
      description={t('archive.explain')}
      confirmLabel={t('archive.confirm')}
      busy={archive.isPending}
      onConfirm={() =>
        archive.mutate(undefined, {
          onSuccess: onClose,
          onError: (e) =>
            toast.error(
              e instanceof ApiError && e.statusCode === 409
                ? t('archive.failedIsDefault')
                : t('archive.failed'),
            ),
        })
      }
    />
  );
}

function DefaultConfirm({
  template,
  onClose,
}: {
  template: PrintTemplateRow;
  onClose: () => void;
}) {
  const { t } = useTranslation('printTemplates');
  const makeDefault = useSetDefaultPrintTemplate(template.id);
  return (
    <ConfirmDialog
      open
      tone="default"
      onOpenChange={(open) => {
        if (!open && !makeDefault.isPending) onClose();
      }}
      title={t('makeDefaultConfirm.title', { name: template.name })}
      description={t('makeDefaultConfirm.explain')}
      confirmLabel={t('actions.makeDefault')}
      busy={makeDefault.isPending}
      onConfirm={() =>
        makeDefault.mutate(undefined, {
          onSuccess: onClose,
          onError: () => toast.error(t('makeDefaultFailed')),
        })
      }
    />
  );
}

export function PrintTemplateLibrary({ onEdit, openNewDialog = false }: PrintTemplateLibraryProps) {
  const { t } = useTranslation('printTemplates');
  const region = useRegionConfig();
  const canManage = useHasPermission(Permission.PRINT_TEMPLATE_MANAGE);
  const templatesQuery = usePrintTemplates();
  const suggestionsQuery = usePrintSuggestions();

  const [kind, setKind] = React.useState('');
  const [newOpen, setNewOpen] = React.useState(openNewDialog);
  const [pickedKey, setPickedKey] = React.useState<string | undefined>(undefined);
  const [archiveRow, setArchiveRow] = React.useState<PrintTemplateRow | undefined>(undefined);
  const [defaultRow, setDefaultRow] = React.useState<PrintTemplateRow | undefined>(undefined);

  const all = templatesQuery.data ?? [];
  // Grouped by document type (then by name) so each type's designs sit together.
  const rows = all
    .filter((x) => x.archived_at === null && (kind === '' || x.document_kind === kind))
    .sort(
      (a, b) =>
        (KIND_ORDER[a.document_kind] ?? 99) - (KIND_ORDER[b.document_kind] ?? 99) ||
        a.name.localeCompare(b.name),
    );

  function openNew(suggestionKey?: string) {
    setPickedKey(suggestionKey);
    setNewOpen(true);
  }

  // `n` opens "New design" when focus is inside the list (not in a field). Attached to the
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
    {
      id: 'name',
      header: t('columns.name'),
      accessorFn: (row) => (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{row.name}</span>
          {row.is_default && <StatusBadge tone="info" label={t('default')} />}
        </span>
      ),
      card: 'title',
    },
    { id: 'type', header: t('columns.type'), accessorFn: (row) => t(`kind.${row.document_kind}`) },
    {
      id: 'status',
      header: t('columns.status'),
      accessorFn: (row) => (
        <StatusBadge
          tone={row.current_version_id ? 'success' : 'neutral'}
          label={row.current_version_id ? t('status.published') : t('status.draft')}
        />
      ),
      card: 'badge',
    },
    {
      id: 'batch',
      header: t('columns.batch'),
      accessorFn: (row) => formatNumber(row.batch_size, region),
      align: 'end',
    },
    {
      id: 'updated',
      header: t('columns.updated'),
      accessorFn: (row) => formatDate(row.updated_at, region),
      card: 'subtitle',
    },
  ];

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'kind',
      label: t('filters.kind'),
      allLabel: t('filters.allKinds'),
      options: (['STUDENT_ID_CARD', 'STAFF_ID_CARD', 'ACR_ASSESSMENT'] as const).map((k) => ({
        value: k,
        label: t(`kind.${k}`),
      })),
    },
  ];

  const noTemplatesAtAll = !templatesQuery.isPending && !templatesQuery.isError && all.length === 0;

  const headerActions = canManage
    ? [
        {
          id: 'new',
          label: t('new'),
          icon: <PlusIcon aria-hidden />,
          priority: 'primary' as const,
          onClick: () => openNew(),
        },
      ]
    : [];

  return (
    <div ref={rootRef}>
      {noTemplatesAtAll ? (
        <div className="flex flex-col gap-4">
          <PageHeader title={t('title')} subtitle={t('subtitle')} actions={headerActions} />
          <Card padded asChild>
            <section aria-label={t('empty.heading')}>
              <h2 className="text-h2">{t('empty.heading')}</h2>
              <p className="mt-1 text-text-secondary">{t('empty.explanation')}</p>
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
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
          </Card>
        </div>
      ) : (
        <ListShell
          title={t('title')}
          subtitle={t('subtitle')}
          actions={headerActions}
          filters={{
            fields: filterFields,
            values: kind ? { kind } : {},
            onChange: (patch) => setKind(patch.kind ?? ''),
          }}
          tableId="print-templates-list"
          caption={t('caption')}
          columns={columns}
          rowActions={(row) => [
            { intent: 'edit', label: t('actions.edit'), onClick: () => onEdit(row.id) },
            {
              intent: 'approve',
              label: t('actions.makeDefault'),
              icon: <StarIcon className="size-4 text-text-secondary" aria-hidden />,
              allowed: canManage && row.current_version_id !== null && !row.is_default,
              onClick: () => setDefaultRow(row),
            },
            {
              intent: 'archive',
              label: t('actions.archive'),
              allowed: canManage,
              onClick: () => setArchiveRow(row),
            },
          ]}
          data={rows}
          getRowId={(row) => row.id}
          sorting={null}
          onSortingChange={() => undefined}
          paginated={false}
          totalCount={rows.length}
          loading={templatesQuery.isLoading}
          isFetching={templatesQuery.isFetching}
          {...(templatesQuery.isError ? { error: t('loadError') } : {})}
          emptyMessage={t('empty.explanation')}
          announceResults={(count, total) => `${count} / ${total}`}
        />
      )}

      {archiveRow ? (
        <ArchiveConfirm template={archiveRow} onClose={() => setArchiveRow(undefined)} />
      ) : null}
      {defaultRow ? (
        <DefaultConfirm template={defaultRow} onClose={() => setDefaultRow(undefined)} />
      ) : null}

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
