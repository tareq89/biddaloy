/**
 * D22: full-screen create/edit page with a sticky header and footer. Stub —
 * filled in by 31.2.6 (Esc, dirty-confirm). `useCloseFullPage` is final.
 */
import { useRouter } from '@tanstack/react-router';
import { XIcon } from 'lucide-react';
import * as React from 'react';

import { Button } from '../components/button';
import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

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
  size = 'form',
  primary,
  secondary,
  children,
}: FullPageShellProps) {
  const { t } = useTranslation('common');
  const width = size === 'wide' ? 'max-w-5xl' : 'max-w-3xl';
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="sticky top-0 z-30 border-b border-border-subtle bg-surface">
        <div className="flex h-14 items-center justify-between gap-4 px-4 md:h-16 md:px-6">
          <h1 className="truncate text-h2 md:text-h1">{title}</h1>
          <Button type="button" variant="outline" onClick={onClose}>
            <XIcon aria-hidden="true" />
            {t('actions.close')}
          </Button>
        </div>
      </header>
      <main className={cn('mx-auto w-full flex-1 space-y-6 px-4 py-4 md:px-6 md:py-6', width)}>
        {children}
      </main>
      <footer className="sticky bottom-0 z-30 border-t border-border-subtle bg-surface">
        <div
          className={cn(
            'mx-auto flex w-full items-center justify-between gap-2 px-4 py-3 md:px-6',
            width,
          )}
        >
          <div>
            {secondary && (
              <Button type="button" variant="outline" onClick={secondary.onClick}>
                {secondary.label}
              </Button>
            )}
          </div>
          <Button
            type="button"
            loading={primary.busy ?? false}
            disabled={primary.disabled ?? false}
            onClick={primary.onClick}
          >
            {primary.label}
          </Button>
        </div>
      </footer>
    </div>
  );
}

/** D22 "closing returns to where the user came from": history back when there is an in-app
 * entry, else `fallback` (deep link / new tab). */
export function useCloseFullPage(fallback: () => void): () => void {
  // Router types are not registered inside the ui package, so `useRouter()` is `any` here.
  const router = useRouter() as { history: { canGoBack: () => boolean; back: () => void } };
  return React.useCallback(
    () => (router.history.canGoBack() ? router.history.back() : fallback()),
    [router, fallback],
  );
}
