/**
 * [14.13.3] School detail's "Restore from workbook" action — the same
 * `RestoreWizard` (14.11.3) the create-school success step's optional
 * import section uses, pointed at this already-provisioned school's
 * `tenantId` via its `tenantId`/`expectedSchoolName` props. See
 * `RestoreWizard`'s own doc comment for why those props exist: this
 * school is a SUPER_ADMIN's target, never their active tenant.
 *
 * `max-h-[85vh] overflow-y-auto` on `DialogContent`: `RestoreWizard`
 * renders a per-tab diff table plus the confirmation field and Confirm
 * button below it, easily taller than the viewport for a real workbook —
 * `DialogContent` itself has no height cap or scroll area (it's
 * `fixed`/centered with unconstrained height), so the Confirm button was
 * pushed below the visible viewport with nothing to scroll it into view.
 * Found the hard way: the e2e journey that exercises this dialog with a
 * real multi-row diff timed out clicking a Confirm button Playwright could
 * locate in the DOM but never bring into the viewport.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

import { RestoreWizard } from '../../../../pages/settings/restore-wizard';

export interface RestoreWorkbookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName: string;
}

export function RestoreWorkbookDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
}: RestoreWorkbookDialogProps) {
  const { t } = useTranslation('platform');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('schoolDetail.restoreWorkbookDialog.title', { name: schoolName })}
          </DialogTitle>
        </DialogHeader>
        <RestoreWizard tenantId={schoolId} expectedSchoolName={schoolName} />
      </DialogContent>
    </Dialog>
  );
}
