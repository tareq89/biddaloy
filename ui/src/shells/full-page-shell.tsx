/**
 * D22: full-screen create/edit page. Built on a Radix Dialog (always open), so the portal
 * covers sidebar / top bar / bottom bar and gives the focus trap and scroll lock for free.
 * Close / Esc ask before discarding when `dirty`.
 *
 * Own chromeless route (`staticData: { chromeless: true }`):
 *   const close = useCloseFullPage(() => void navigate({ to: '/print-templates' }));
 *   <FullPageShell title=... onClose={close} size="wide" primary={{ label, onClick }}>...</FullPageShell>
 *
 * Overlay on a host route (optional `add: z.literal(1).optional()` in its validateSearch):
 *   const closeAdd = useCloseFullPage(() => void navigate({ search: ({ add: _a, ...rest }) => rest, replace: true }));
 *   {search.add === 1 && <FullPageShell title=... onClose={closeAdd} dirty={form.formState.isDirty}
 *     primary={{ label, onClick: form.handleSubmit(save) }}>...</FullPageShell>}
 * The primary button sits outside the page's <form>; submit via `onClick`.
 */
import { useRouter } from '@tanstack/react-router';
import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';

import { Button } from '../components/button';
import { ConfirmDialog } from '../components/confirm-dialog';
import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

import { useWarnUnsavedChanges } from './use-form-shell';

export interface FullPageShellAction {
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}

export interface FullPageShellProps {
  title: string;
  onClose: () => void;
  dirty?: boolean;
  size?: 'form' | 'wide';
  primary: FullPageShellAction;
  secondary?: Pick<FullPageShellAction, 'label' | 'onClick'>;
  children: React.ReactNode;
}

export function FullPageShell({
  title,
  onClose,
  dirty,
  size = 'form',
  primary,
  secondary,
  children,
}: FullPageShellProps) {
  const { t } = useTranslation('common');
  const [confirming, setConfirming] = React.useState(false);
  useWarnUnsavedChanges(dirty === true);
  const requestClose = () => (dirty ? setConfirming(true) : onClose());
  const width = size === 'wide' ? 'max-w-5xl' : 'max-w-3xl';
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          data-slot="full-page-shell"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            requestClose();
          }}
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-bg outline-none"
        >
          <header className="sticky top-0 z-30 border-b border-border-subtle bg-surface">
            <div className="flex h-14 items-center justify-between gap-4 px-4 md:h-16 md:px-6">
              <DialogPrimitive.Title asChild>
                <h1 className="truncate text-h2 md:text-h1">{title}</h1>
              </DialogPrimitive.Title>
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0"
                onClick={requestClose}
              >
                <XIcon aria-hidden="true" />
                {t('actions.close')}
              </Button>
            </div>
          </header>
          <div className={cn('mx-auto w-full flex-1 space-y-6 px-4 py-4 md:px-6 md:py-6', width)}>
            {children}
          </div>
          <footer className="sticky bottom-0 z-30 border-t border-border-subtle bg-surface">
            <div
              className={cn(
                'mx-auto flex w-full items-center justify-between gap-2 px-4 py-3 md:px-6',
                width,
              )}
            >
              {secondary ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={secondary.onClick}
                >
                  {secondary.label}
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="button"
                className="h-11"
                loading={primary.busy ?? false}
                disabled={primary.disabled ?? false}
                onClick={primary.onClick}
              >
                {primary.label}
              </Button>
            </div>
          </footer>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            tone="danger"
            title={t('fullPage.discardTitle')}
            description={t('fullPage.discardDescription')}
            confirmLabel={t('fullPage.discardConfirm')}
            cancelLabel={t('fullPage.keepEditing')}
            onConfirm={() => {
              setConfirming(false);
              onClose();
            }}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** D22 "closing returns to where the user came from": history back when there is an in-app
 * entry, else `fallback` (deep link / new tab). For an overlay, open it with a push (no
 * `replace`) so that back removes `add`; an overlay opened with `replace` must pass its own
 * close function to `onClose` instead of this hook, or back would leave the host route. */
export function useCloseFullPage(fallback: () => void): () => void {
  // Router types are not registered inside the ui package, so `useRouter()` is `any` here.
  const router = useRouter() as { history: { canGoBack: () => boolean; back: () => void } };
  return React.useCallback(
    () => (router.history.canGoBack() ? router.history.back() : fallback()),
    [router, fallback],
  );
}
