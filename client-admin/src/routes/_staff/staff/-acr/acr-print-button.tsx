import { Permission } from '@biddaloy/shared';
import { Button } from '@biddaloy/ui/components';
import { useHasPermission, type AcrAssessment } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useNavigate, useRouterState } from '@tanstack/react-router';

/**
 * [28.6.1] Print a COMPLETED ACR through the print module (the preview page picks the
 * template). The server enforces the same rules (ACR_READ, not your own ACR, completed
 * only); this just hides a button that would be refused.
 */
export function AcrPrintButton({
  assessment,
}: {
  assessment: Pick<AcrAssessment, 'id' | 'status'>;
}) {
  const { t } = useTranslation('evaluations');
  const navigate = useNavigate();
  const from = useRouterState({ select: (s) => s.location.pathname });
  const canRead = useHasPermission(Permission.ACR_READ);
  const canPrint = useHasPermission(Permission.DOCUMENT_PRINT);
  if (assessment.status !== 'COMPLETED' || !canRead || !canPrint) return null;
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() =>
        void navigate({
          to: '/print/preview',
          search: { kind: 'ACR_ASSESSMENT', subject_type: 'ACR', ids: assessment.id, from },
        })
      }
    >
      {t('acr.print')}
    </Button>
  );
}
