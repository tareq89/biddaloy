import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Skeleton,
  StatusBadge,
  toast,
} from '@biddaloy/ui/components';
import {
  useHolidaySet,
  usePublishHolidaySet,
  useUnpublishHolidaySet,
  useUpdateHolidaySetEntries,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { formatDateTime } from '@biddaloy/ui/utils';
import { createFileRoute, useBlocker } from '@tanstack/react-router';
import { GlobeIcon, GlobeLockIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { HolidaySetEditor } from './-holiday-set-editor';
import { holidaySetName, SOURCE_LABEL_KEY } from './-holiday-set-name';

/**
 * [17.3.5/#715] One holiday set's detail page — edit entries, save, and
 * publish/unpublish. `HolidaySetEditor` (`-holiday-set-editor.tsx`) owns
 * the actual row-editing UI so it can be storied on its own; this file
 * wires the live queries, the router unsaved-changes guard and the header.
 *
 * [31.4.platform-3] `DetailShell` (crumbs are the way back, D16/D20):
 * Publish / Unpublish is an outline header action — it acts on the whole
 * list — disabled while there are unsaved changes, with the reason shown
 * as visible text. Save is the one filled button, in the entries card.
 */
export const Route = createFileRoute('/_platform/holiday-sets/$setId')({
  loader: () => loadRouteNamespaces('platform'),
  component: HolidaySetDetailPage,
});

function HolidaySetDetailPage() {
  const { setId } = Route.useParams();
  const { t, i18n } = useTranslation('platform');
  const config = useRegionConfig();
  const setQuery = useHolidaySet(setId);
  const updateEntries = useUpdateHolidaySetEntries(setId);
  const publishSet = usePublishHolidaySet(setId);
  const unpublishSet = useUnpublishHolidaySet(setId);
  const [isDirty, setIsDirty] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [unpublishOpen, setUnpublishOpen] = React.useState(false);

  useWarnUnsavedChanges(isDirty);
  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: false,
    withResolver: true,
  });

  const set = setQuery.data;

  function publish() {
    publishSet.mutate(undefined, {
      onSuccess: () => {
        setPublishOpen(false);
        toast.success(t('holidaySets.detail.publishSuccess'));
      },
      onError: () => toast.error(t('holidaySets.detail.publishError')),
    });
  }

  function unpublish() {
    unpublishSet.mutate(undefined, {
      onSuccess: () => {
        setUnpublishOpen(false);
        toast.success(t('holidaySets.detail.unpublishSuccess'));
      },
      onError: () => toast.error(t('holidaySets.detail.unpublishError')),
    });
  }

  const leaveGuard = (
    <ConfirmDialog
      open={blocker.status === 'blocked'}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.();
      }}
      tone="danger"
      title={t('holidaySets.detail.unsavedChangesDialog.title')}
      description={t('holidaySets.detail.unsavedChangesDialog.description')}
      cancelLabel={t('holidaySets.detail.unsavedChangesDialog.stayAction')}
      confirmLabel={t('holidaySets.detail.unsavedChangesDialog.leaveAction')}
      onConfirm={() => blocker.proceed?.()}
    />
  );

  if (setQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (setQuery.isError || !set) {
    return (
      <ErrorState
        message={t('holidaySets.detail.loadError')}
        retryLabel={t('actions.retry', { ns: 'common' })}
        onRetry={() => void setQuery.refetch()}
      />
    );
  }

  const published = set.published_at !== null;

  return (
    <>
      <DetailShell
        name={holidaySetName(set, i18n.language, t)}
        statusBadge={
          <StatusBadge
            tone={published ? 'success' : 'neutral'}
            label={t(published ? 'holidaySets.published' : 'holidaySets.draft')}
          />
        }
        facts={[
          { label: t('holidaySets.detail.sourceLabel'), value: t(SOURCE_LABEL_KEY[set.source]) },
          {
            label: t('holidaySets.detail.fetchedAtLabel'),
            value: formatDateTime(set.fetched_at, config),
          },
          {
            label: t('holidaySets.columnEntries'),
            value: t('holidaySets.entryCount', { count: set.entries.length }),
          },
        ]}
        actions={[
          published
            ? {
                id: 'unpublish',
                label: t('holidaySets.detail.unpublishAction'),
                icon: <GlobeLockIcon aria-hidden="true" />,
                priority: 'secondary',
                disabled: isDirty || unpublishSet.isPending,
                onClick: () => setUnpublishOpen(true),
              }
            : {
                id: 'publish',
                label: t('holidaySets.detail.publishAction'),
                icon: <GlobeIcon aria-hidden="true" />,
                priority: 'secondary',
                disabled: isDirty || publishSet.isPending,
                onClick: () => setPublishOpen(true),
              },
        ]}
      >
        {isDirty && (
          <p id="publish-hint" className="text-caption text-text-secondary">
            {t('holidaySets.detail.publishDisabledHint')}
          </p>
        )}
        <HolidaySetEditor
          key={set.updated_at}
          set={set}
          onDirtyChange={setIsDirty}
          onSave={(entries) =>
            updateEntries.mutate(entries, {
              onSuccess: () => toast.success(t('holidaySets.detail.saveSuccess')),
            })
          }
          isSaving={updateEntries.isPending}
          saveError={updateEntries.error}
          saveSucceeded={updateEntries.isSuccess}
        />
      </DetailShell>

      <Dialog
        open={publishOpen}
        // A pending request must not be dismissed from under itself.
        onOpenChange={(open) => {
          if (!open && publishSet.isPending) return;
          setPublishOpen(open);
        }}
      >
        <DialogContent
          size="sm"
          showCloseButton={!publishSet.isPending}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t('holidaySets.detail.publishDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('holidaySets.detail.publishDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={publishSet.isPending}>
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="button" loading={publishSet.isPending} onClick={publish}>
              {t('holidaySets.detail.publishDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={unpublishOpen}
        onOpenChange={(open) => {
          if (!open && unpublishSet.isPending) return;
          setUnpublishOpen(open);
        }}
        tone="danger"
        title={t('holidaySets.detail.unpublishDialog.title')}
        description={t('holidaySets.detail.unpublishDialog.description')}
        confirmLabel={t('holidaySets.detail.unpublishDialog.confirm')}
        busy={unpublishSet.isPending}
        onConfirm={unpublish}
      />

      {leaveGuard}
    </>
  );
}
