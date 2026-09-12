/**
 * [14.13.3] School detail's "Restore from workbook" action — the same
 * `RestoreWizard` (14.11.3) the create-school success step's optional
 * import section uses, pointed at this already-provisioned school's
 * `tenantId` via its `tenantId`/`expectedSchoolName` props. See
 * `RestoreWizard`'s own doc comment for why those props exist: this
 * school is a SUPER_ADMIN's target, never their active tenant.
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
      <DialogContent className="max-w-2xl">
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
