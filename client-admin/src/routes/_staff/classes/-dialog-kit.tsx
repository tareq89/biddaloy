/**
 * Lane-local form bits for the classes dialogs (`kit FormField` is
 * react-hook-form only, and these dialogs use plain state): a labelled
 * field with the kit's required mark, and the kit error text.
 */
import { ConfirmDialog } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { CircleAlertIcon } from 'lucide-react';
import * as React from 'react';

/** Close handling for a form dialog: ignored while a request is in flight,
 * asks before discarding unsaved edits. Render `discardDialog` beside the
 * dialog and call `requestClose` from Esc / X / Cancel. */
export function useCloseGuard(
  isDirty: boolean,
  isPending: boolean,
  onOpenChange: (open: boolean) => void,
) {
  const { t } = useTranslation('common');
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const requestClose = () => {
    if (isPending) return;
    if (isDirty) setDiscardOpen(true);
    else onOpenChange(false);
  };
  const discardDialog = (
    <ConfirmDialog
      open={discardOpen}
      onOpenChange={setDiscardOpen}
      title={t('fullPage.discardTitle')}
      description={t('fullPage.discardDescription')}
      confirmLabel={t('fullPage.discardConfirm')}
      cancelLabel={t('fullPage.keepEditing')}
      tone="default"
      onConfirm={() => {
        setDiscardOpen(false);
        onOpenChange(false);
      }}
    />
  );
  return { requestClose, discardDialog };
}

export function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('common');
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label text-text-primary">
        {label}
        {required && (
          <>
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
            <span className="sr-only">{t('form.required')}</span>
          </>
        )}
      </label>
      {children}
    </div>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
      <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}
