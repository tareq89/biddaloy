/** Cancel in a FullPageShell footer bypasses the shell's own close guard, so it asks here. */
import { ConfirmDialog } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

export function DiscardConfirm({
  open,
  onOpenChange,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation('common');
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="danger"
      title={t('fullPage.discardTitle')}
      description={t('fullPage.discardDescription')}
      confirmLabel={t('fullPage.discardConfirm')}
      cancelLabel={t('fullPage.keepEditing')}
      onConfirm={onDiscard}
    />
  );
}
