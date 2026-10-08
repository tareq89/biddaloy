/**
 * [22.4.1] Create + assign page. The command palette's "Assign homework"
 * action lands here (no per-context prefill yet — plan corrections §5),
 * and the homework list's own "Assign homework" button too. Optional
 * `class_id`/`section_id`/`subject_id` search params prefill the form,
 * which lets a future section-scoped entry point (22.4.6) deep-link here.
 */
import { Card, ConfirmDialog, RoutePending } from '@biddaloy/ui/components';
import { useAssignHomework, useCreateHomework } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { AssignHomeworkForm, type AssignHomeworkFormSubmitPayload } from './-assign-homework-form';

const FORM_ID = 'homework-create-form';

const newHomeworkSearchSchema = z.object({
  class_id: z.string().optional().catch(undefined),
  section_id: z.string().optional().catch(undefined),
  subject_id: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/academics/homework/new')({
  validateSearch: newHomeworkSearchSchema,
  loader: () => loadRouteNamespaces('homework'),
  pendingComponent: NewHomeworkPending,
  component: NewHomeworkPage,
});

function NewHomeworkPage() {
  const search = Route.useSearch();
  const { t } = useTranslation('homework');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const close = useCloseFullPage(() => void navigate({ to: '/academics/homework' }));

  const createHomework = useCreateHomework();
  const assignHomework = useAssignHomework();
  const regionConfig = useTenantRegionConfig();

  const [createdId, setCreatedId] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | undefined>(undefined);
  const [dirty, setDirty] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const pending = createHomework.isPending || assignHomework.isPending;
  const guardedClose = () => {
    if (!pending) close();
  };

  // Blocks a second submit fired before `pending` has re-rendered.
  const inFlight = React.useRef(false);

  async function handleSubmit(payload: AssignHomeworkFormSubmitPayload) {
    if (inFlight.current) return;
    inFlight.current = true;
    setErrorMessage(undefined);
    try {
      let homeworkId = createdId;
      if (homeworkId === null) {
        const homework = await createHomework.mutateAsync(payload.homework!);
        homeworkId = homework.id;
        setCreatedId(homeworkId);
      }
      await assignHomework.mutateAsync({ homeworkId, input: payload.assignment });
      void navigate({ to: '/academics/homework/$homeworkId', params: { homeworkId } });
    } catch {
      // Never print the server's message: it is not translated (D9).
      setErrorMessage(t('form.genericError'));
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <RegionConfigProvider value={regionConfig}>
      <FullPageShell
        title={t('form.createTitle')}
        size="form"
        dirty={dirty}
        onClose={guardedClose}
        secondary={{
          label: tCommon('actions.cancel'),
          // The footer's secondary bypasses the shell's dirty check.
          onClick: () => {
            if (pending) return;
            if (dirty) setDiscardOpen(true);
            else close();
          },
        }}
        primary={{
          label: t('form.submitCreate'),
          busy: pending,
          onClick: () =>
            (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit(),
        }}
      >
        <div className="flex flex-col gap-6">
          {createdId !== null && (assignHomework.isError || errorMessage !== undefined) && (
            <Card padded role="alert" className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              <p>
                {t('form.assignFailedAfterCreate')}{' '}
                <Link
                  to="/academics/homework/$homeworkId"
                  params={{ homeworkId: createdId }}
                  className="underline"
                >
                  {t('form.viewCreatedHomework')}
                </Link>
              </p>
            </Card>
          )}

          <AssignHomeworkForm
            mode="create"
            formId={FORM_ID}
            hideFooter
            onDirtyChange={setDirty}
            initial={{
              ...(search.class_id !== undefined ? { classId: search.class_id } : {}),
              ...(search.section_id !== undefined ? { sectionId: search.section_id } : {}),
              ...(search.subject_id !== undefined ? { subjectId: search.subject_id } : {}),
            }}
            isPending={pending}
            {...(createdId === null && errorMessage !== undefined ? { error: errorMessage } : {})}
            onSubmit={(payload) => void handleSubmit(payload)}
          />
        </div>
      </FullPageShell>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={tCommon('fullPage.discardTitle')}
        description={tCommon('fullPage.discardDescription')}
        confirmLabel={tCommon('fullPage.discardConfirm')}
        cancelLabel={tCommon('fullPage.keepEditing')}
        tone="danger"
        onConfirm={guardedClose}
      />
    </RegionConfigProvider>
  );
}

function NewHomeworkPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
