/**
 * Intake edit page — [27.9]. Same field set as create
 * (`IntakeForm`), pre-filled from the loaded intake.
 */
import { Button, ErrorState, RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import {
  intakeQueryOptions,
  useIntake,
  useUpdateIntake,
} from '../../../../features/admission/hooks/useIntakes';
import {
  IntakeForm,
  type IntakeFormValue,
  toIntakeInput,
} from '../../../../features/admission/IntakeForm';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/admissions/intakes/$intakeId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient.ensureQueryData(intakeQueryOptions(params.intakeId)).catch(swallowUnlessOffline),
      loadRouteNamespaces('admission-staff-intakes', 'common'),
    ]),
  pendingComponent: IntakeDetailPending,
  component: IntakeDetailPage,
});

function IntakeDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}

function IntakeDetailPage() {
  const { intakeId } = Route.useParams();
  const { t } = useTranslation('admission-staff-intakes');
  const intakeQuery = useIntake(intakeId);
  const updateIntake = useUpdateIntake(intakeId);

  const [form, setForm] = React.useState<IntakeFormValue | null>(null);

  React.useEffect(() => {
    if (intakeQuery.data && form === null) {
      setForm({
        title: intakeQuery.data.title,
        class_section_id: intakeQuery.data.class_section_id,
        seat_count: String(intakeQuery.data.seat_count),
        open_date: intakeQuery.data.open_date,
        close_date: intakeQuery.data.close_date,
        required_document_types: intakeQuery.data.required_document_types,
      });
    }
  }, [intakeQuery.data, form]);

  if (intakeQuery.isError) {
    return (
      <ErrorState
        message={t('detail.errorMessage', { ns: 'admission-staff-intakes' })}
        onRetry={() => void intakeQuery.refetch()}
      />
    );
  }

  if (intakeQuery.isLoading || form === null) {
    return <IntakeDetailPending />;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (form === null) return;
    updateIntake.mutate(toIntakeInput(form));
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{intakeQuery.data?.title}</h1>
      <form onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-4">
        <IntakeForm value={form} onChange={setForm} />

        {updateIntake.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('detail.errorMessage', { ns: 'admission-staff-intakes' })}
          </p>
        )}

        <Button type="submit" loading={updateIntake.isPending}>
          {updateIntake.isPending
            ? t('detail.saving', { ns: 'admission-staff-intakes' })
            : t('detail.save', { ns: 'admission-staff-intakes' })}
        </Button>
      </form>
    </div>
  );
}
