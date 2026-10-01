/**
 * Full-screen print preview — [32.4.1]. Reached from a list's Print action with either an
 * explicit `ids` list or a `class_section_id` ("print the whole class"), which is resolved
 * to ids here. `from` is the path to return to when every batch is confirmed.
 */
import { DocumentKind, PrintSubjectType } from '@biddaloy/shared';
import { Skeleton } from '@biddaloy/ui/components';
import { studentIdsQueryOptions } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { z } from 'zod';

import { DesktopOnlyGate } from '../../../components/print/desktop-only-gate';
import { PrintPreview } from '../../../components/print/preview/print-preview';
import { PrintIdCardModal } from '../../../components/print/print-id-card-modal';
import { loadRouteNamespaces } from '../../../route-loaders';

const searchSchema = z.object({
  // A bad or missing value falls back rather than breaking the page.
  kind: z.enum(DocumentKind).catch(DocumentKind.STUDENT_ID_CARD),
  subject_type: z.enum(PrintSubjectType).catch(PrintSubjectType.STUDENT),
  ids: z.string().optional().catch(undefined),
  class_section_id: z.string().uuid().optional().catch(undefined),
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
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();

  // "Print the whole class": one call returns every id in the section.
  const bySection = useQuery({
    ...studentIdsQueryOptions(
      search.class_section_id !== undefined ? { section_id: search.class_section_id } : {},
    ),
    enabled: search.class_section_id !== undefined,
  });
  const explicit = search.ids ? search.ids.split(',').filter(Boolean) : [];
  const ids = search.class_section_id !== undefined ? (bySection.data?.ids ?? []) : explicit;

  // Opened with nobody chosen (the command palette's "Print ID card"): pick people first.
  if (search.ids === undefined && search.class_section_id === undefined) {
    return (
      <DesktopOnlyGate backTo={search.from ?? '/'}>
        <PrintIdCardModal
          open
          initialType={search.subject_type}
          onCancel={() => router.history.push(search.from ?? '/')}
          onConfirm={(choice) =>
            void navigate({
              search: (prev) => ({
                ...prev,
                kind: choice.subjectType === 'STAFF' ? 'STAFF_ID_CARD' : 'STUDENT_ID_CARD',
                subject_type: choice.subjectType,
                ...('classSectionId' in choice
                  ? { class_section_id: choice.classSectionId }
                  : { ids: choice.ids }),
              }),
            })
          }
        />
      </DesktopOnlyGate>
    );
  }

  return (
    <DesktopOnlyGate backTo={search.from ?? '/'}>
      {search.class_section_id !== undefined && bySection.isPending ? (
        <Skeleton role="status" aria-label={t('loading')} className="m-6 h-40" />
      ) : (
        <PrintPreview
          documentKind={search.kind}
          subjectType={search.subject_type}
          subjectIds={ids}
          onCreateTemplate={() => void navigate({ to: '/print-templates', search: { new: '1' } })}
          onAddPrinter={() => void navigate({ to: '/settings', hash: 'printers-section' })}
          // `from` is an in-app path checked by the schema, not a typed route.
          onDone={() => router.history.push(search.from ?? '/')}
        />
      )}
    </DesktopOnlyGate>
  );
}
