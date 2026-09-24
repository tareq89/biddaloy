/**
 * [22.4.1] Create + assign page. The command palette's "Assign homework"
 * action lands here (no per-context prefill yet — plan corrections §5),
 * and the homework list's own "Assign homework" button too. Optional
 * `class_id`/`section_id`/`subject_id` search params prefill the form,
 * which lets a future section-scoped entry point (22.4.6) deep-link here.
 */
import { ApiError } from '@biddaloy/ui/api';
import { RoutePending } from '@biddaloy/ui/components';
import { useAssignHomework, useCreateHomework } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { AssignHomeworkForm, type AssignHomeworkFormSubmitPayload } from './-assign-homework-form';

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
  const navigate = useNavigate();

  const createHomework = useCreateHomework();
  const assignHomework = useAssignHomework();

  const [createdId, setCreatedId] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | undefined>(undefined);

  async function handleSubmit(payload: AssignHomeworkFormSubmitPayload) {
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
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : t('form.genericError'));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('form.createTitle')}</h1>

      {createdId !== null && (assignHomework.isError || errorMessage !== undefined) && (
        <p role="alert" className="text-sm text-destructive">
          {t('form.assignFailedAfterCreate')}{' '}
          <Link
            to="/academics/homework/$homeworkId"
            params={{ homeworkId: createdId }}
            className="underline"
          >
            {t('form.viewCreatedHomework')}
          </Link>
        </p>
      )}

      <AssignHomeworkForm
        mode="create"
        initial={{
          ...(search.class_id !== undefined ? { classId: search.class_id } : {}),
          ...(search.section_id !== undefined ? { sectionId: search.section_id } : {}),
          ...(search.subject_id !== undefined ? { subjectId: search.subject_id } : {}),
        }}
        isPending={createHomework.isPending || assignHomework.isPending}
        {...(createdId === null && errorMessage !== undefined ? { error: errorMessage } : {})}
        onSubmit={(payload) => void handleSubmit(payload)}
      />
    </div>
  );
}

function NewHomeworkPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
