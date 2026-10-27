/**
 * Intake edit page — [27.9]. Same field set as create
 * (`IntakeForm`), pre-filled from the loaded intake.
 */
import { isNotFoundError } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  RecordNotFoundState,
  RoutePending,
  StatusBadge,
  toast,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { UsersIcon } from 'lucide-react';
import * as React from 'react';

import { useApplicants } from '../../../../features/admission/hooks/useApplicants';
import {
  intakeQueryOptions,
  useCloseIntake,
  useIntake,
  useUpdateIntake,
} from '../../../../features/admission/hooks/useIntakes';
import {
  IntakeForm,
  isIntakeFormValid,
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
  const { t } = useTranslation('admission-staff-intakes');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}

function IntakeDetailPage() {
  const { intakeId } = Route.useParams();
  const { t } = useTranslation('admission-staff-intakes');
  const regionConfig = useRegionConfig();
  const navigate = Route.useNavigate();
  const intakeQuery = useIntake(intakeId);
  const applicantsQuery = useApplicants({ intakeId });
  const updateIntake = useUpdateIntake(intakeId);
  const closeIntake = useCloseIntake(intakeId);
  const [closeOpen, setCloseOpen] = React.useState(false);

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

  if (isNotFoundError(intakeQuery.error)) {
    return <RecordNotFoundState onBack={() => void navigate({ to: '/admissions/intakes' })} />;
  }

  if (intakeQuery.isError) {
    return (
      <ErrorState message={t('detail.loadError')} onRetry={() => void intakeQuery.refetch()} />
    );
  }

  if (intakeQuery.isLoading || form === null || !intakeQuery.data) {
    return <IntakeDetailPending />;
  }

  const intake = intakeQuery.data;
  const count = applicantsQuery.data?.length;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (form === null || !isIntakeFormValid(form)) return;
    updateIntake.mutate(toIntakeInput(form), {
      onSuccess: () => toast.success(t('detail.saved')),
    });
  }

  function handleClose() {
    closeIntake.mutate(undefined, {
      onSuccess: () => {
        setCloseOpen(false);
        setForm(null); // re-seed the form from the refetched (closed) intake
        toast.success(t('detail.closed'));
      },
    });
  }

  return (
    <PageContainer size="narrow">
      {/* ponytail: FormShell/PageHeader take no status badge or outline action beside the title,
          so this header is local. Shared request: a badge slot on PageHeader. */}
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-h1">{intake.title}</h1>
            <StatusBadge
              tone={intake.status === 'OPEN' ? 'success' : 'neutral'}
              label={intake.status === 'OPEN' ? t('list.statusOpen') : t('list.statusClosed')}
            />
          </div>
          {count !== undefined && (
            <p className="mt-0.5 text-text-secondary">
              {t('detail.applicantCount', { count, formatted: formatNumber(count, regionConfig) })}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 md:flex-row">
          {intake.status === 'OPEN' && (
            <Button
              variant="outline"
              className="w-full md:w-auto"
              onClick={() => {
                closeIntake.reset();
                setCloseOpen(true);
              }}
            >
              {t('detail.closeNow')}
            </Button>
          )}
          <Button asChild variant="outline" className="w-full md:w-auto">
            <Link to="/admissions/applicants" search={{ intakeId }}>
              <UsersIcon aria-hidden />
              {t('list.viewApplicants')}
            </Link>
          </Button>
        </div>
      </header>

      <ConfirmDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title={t('detail.closeConfirmTitle')}
        description={
          closeIntake.isError
            ? `${t('detail.closeConfirmBody')} ${t('detail.closeFailed')}`
            : t('detail.closeConfirmBody')
        }
        confirmLabel={t('detail.closeNow')}
        tone="danger"
        busy={closeIntake.isPending}
        onConfirm={handleClose}
      />

      <form onSubmit={handleSubmit} noValidate>
        <Card padded>
          <h2 className="mb-4 text-h2">{t('detail.sectionTitle')}</h2>
          <IntakeForm value={form} onChange={setForm} />

          {updateIntake.isError && (
            <p role="alert" className="mt-4 text-destructive">
              {t('detail.errorMessage')}
            </p>
          )}

          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border-subtle pt-4 md:flex-row md:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => void navigate({ to: '/admissions/intakes' })}
            >
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button
              type="submit"
              loading={updateIntake.isPending}
              disabled={!isIntakeFormValid(form)}
            >
              {updateIntake.isPending ? t('detail.saving') : t('detail.save')}
            </Button>
          </div>
        </Card>
      </form>
    </PageContainer>
  );
}
