/**
 * Full-screen print preview — [32.4.1]. Reached from a list's Print action with either an
 * explicit `ids` list or a `class_section_id` ("print the whole class"), which is resolved
 * to ids here. `from` is the path to return to when every batch is confirmed.
 *
 * Both steps (picker, preview) are full-page modals with Close. `pick=1` marks a preview
 * reached from the picker, so "Back" returns there; Close leaves the flow.
 */
import { DocumentKind, PrintSubjectType } from '@biddaloy/shared';
import { EmptyState, Skeleton } from '@biddaloy/ui/components';
import { studentIdsQueryOptions } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { MonitorIcon } from 'lucide-react';
import { z } from 'zod';

import { copyPageLink, useIsWide } from '../../../components/print/desktop-only-gate';
import { PrintPreview } from '../../../components/print/preview/print-preview';
import { PrintIdCardModal } from '../../../components/print/print-id-card-modal';
import { loadRouteNamespaces } from '../../../route-loaders';

const searchSchema = z.object({
  // A bad or missing value falls back rather than breaking the page.
  kind: z.enum(DocumentKind).catch(DocumentKind.STUDENT_ID_CARD),
  subject_type: z.enum(PrintSubjectType).catch(PrintSubjectType.STUDENT),
  ids: z.string().optional().catch(undefined),
  class_section_id: z.string().uuid().optional().catch(undefined),
  // Set when the preview was reached from the picker (so "Back" has somewhere to go).
  pick: z.literal('1').optional().catch(undefined),
  // An in-app path only: never navigate to an address typed into the URL.
  from: z
    .string()
    .regex(/^\/(?![/\\])/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/_staff/print/preview')({
  staticData: { chromeless: true },
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('printPreview', 'printTemplates', 'common'),
  component: PrintPreviewPage,
});

function PrintPreviewPage() {
  const { t } = useTranslation('printPreview');
  const { t: tT } = useTranslation('printTemplates');
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const wide = useIsWide();
  // `from` is an in-app path checked by the schema, not a typed route.
  const close = useCloseFullPage(() => router.history.push(search.from ?? '/'));

  // "Print the whole class": one call returns every id in the section.
  const bySection = useQuery({
    ...studentIdsQueryOptions(
      search.class_section_id !== undefined ? { section_id: search.class_section_id } : {},
    ),
    enabled: search.class_section_id !== undefined,
  });
  const explicit = search.ids ? search.ids.split(',').filter(Boolean) : [];
  const ids = search.class_section_id !== undefined ? (bySection.data?.ids ?? []) : explicit;
  const picking = search.ids === undefined && search.class_section_id === undefined;

  // Printing needs a big screen and a printer: on a phone the frame says so, with the same Close.
  if (!wide) {
    return (
      <FullPageShell
        title={picking ? t('picker.title') : t('title')}
        onClose={close}
        primary={{ label: tT('gate.copy'), onClick: () => void copyPageLink(tT) }}
      >
        <EmptyState
          icon={<MonitorIcon aria-hidden />}
          title={tT('gate.title')}
          explanation={tT('gate.body')}
        />
      </FullPageShell>
    );
  }

  // Opened with nobody chosen (the command palette's "Print ID card"): pick people first.
  if (picking) {
    return (
      <PrintIdCardModal
        initialType={search.subject_type}
        onClose={close}
        onConfirm={(choice) =>
          void navigate({
            replace: true,
            search: (prev) => ({
              ...prev,
              pick: '1',
              kind: choice.subjectType === 'STAFF' ? 'STAFF_ID_CARD' : 'STUDENT_ID_CARD',
              subject_type: choice.subjectType,
              ...('classSectionId' in choice
                ? { class_section_id: choice.classSectionId }
                : { ids: choice.ids }),
            }),
          })
        }
      />
    );
  }

  if (search.class_section_id !== undefined && bySection.isPending) {
    return (
      <FullPageShell
        title={t('title')}
        size="wide"
        onClose={close}
        primary={{ label: t('print'), onClick: () => undefined, disabled: true }}
      >
        <Skeleton role="status" aria-label={t('loading')} className="h-40" />
      </FullPageShell>
    );
  }

  return (
    <PrintPreview
      documentKind={search.kind}
      subjectType={search.subject_type}
      subjectIds={ids}
      onCreateTemplate={() => void navigate({ to: '/print-templates', search: { new: '1' } })}
      onAddPrinter={() => void navigate({ to: '/settings', hash: 'printers-section' })}
      onDone={() => router.history.push(search.from ?? '/')}
      onClose={close}
      {...(search.pick === '1'
        ? {
            onBack: () =>
              void navigate({
                replace: true,
                search: (prev) => {
                  const next = { ...prev };
                  delete next.ids;
                  delete next.class_section_id;
                  delete next.pick;
                  return next;
                },
              }),
          }
        : {})}
    />
  );
}
