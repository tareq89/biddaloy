/**
 * Lane-local form bits for the classes dialogs (`kit FormField` is
 * react-hook-form only, and these dialogs use plain state): a labelled
 * field with the kit's required mark, and the kit error text.
 */
import { useTranslation } from '@biddaloy/ui/i18n';
import { CircleAlertIcon } from 'lucide-react';
import type * as React from 'react';

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
