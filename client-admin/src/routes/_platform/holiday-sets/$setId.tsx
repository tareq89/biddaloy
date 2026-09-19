import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import {
  useHolidaySet,
  usePublishHolidaySet,
  useUnpublishHolidaySet,
  useUpdateHolidaySetEntries,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { createFileRoute, Link, useBlocker } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { HolidaySetEditor } from './-holiday-set-editor';

/**
 * [17.3.5/#715] One holiday set's detail page — edit entries, save, and
 * publish/unpublish. `HolidaySetEditor` (`-holiday-set-editor.tsx`) owns
 * the actual row-editing UI so it can be storied on its own; this file
 * wires the live queries, the router unsaved-changes guard, and the
 * back link, same split `SchoolsListView` uses for the list page.
 */
export const Route = createFileRoute('/_platform/holiday-sets/$setId')({
  loader: () => loadRouteNamespaces('platform'),
  component: HolidaySetDetailPage,
});

function HolidaySetDetailPage() {
  const { setId } = Route.useParams();
  const { t } = useTranslation('platform');
  const setQuery = useHolidaySet(setId);
  const updateEntries = useUpdateHolidaySetEntries(setId);
  const publishSet = usePublishHolidaySet(setId);
  const unpublishSet = useUnpublishHolidaySet(setId);
  const [isDirty, setIsDirty] = React.useState(false);

  useWarnUnsavedChanges(isDirty);
  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: false,
    withResolver: true,
  });

  return (
    <div className="flex flex-col gap-4">
      <Link to="/holiday-sets" className="text-sm text-primary underline">
        {t('holidaySets.detail.back')}
      </Link>

      {setQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('holidaySets.detail.loadError')}
        </p>
      )}

      {setQuery.data && (
        <>
          <h1 className="text-lg font-semibold">
            {setQuery.data.country} {setQuery.data.year}
          </h1>
          <HolidaySetEditor
            key={setQuery.data.updated_at}
            set={setQuery.data}
            onDirtyChange={setIsDirty}
            onSave={(entries) => updateEntries.mutate(entries)}
            isSaving={updateEntries.isPending}
            saveError={updateEntries.error}
            saveSucceeded={updateEntries.isSuccess}
            onPublish={() => publishSet.mutate()}
            onUnpublish={() => unpublishSet.mutate()}
            isPublishing={publishSet.isPending}
            isUnpublishing={unpublishSet.isPending}
            publishError={publishSet.error}
            unpublishError={unpublishSet.error}
          />
        </>
      )}

      <Dialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => !open && blocker.reset?.()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('holidaySets.detail.unsavedChangesDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('holidaySets.detail.unsavedChangesDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('holidaySets.detail.unsavedChangesDialog.stayAction')}
              </Button>
            </DialogClose>
            <Button type="button" variant="destructive" onClick={() => blocker.proceed?.()}>
              {t('holidaySets.detail.unsavedChangesDialog.leaveAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
