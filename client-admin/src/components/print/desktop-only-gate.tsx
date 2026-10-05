/**
 * [32.4.1] Designing and printing need a big screen and a real printer (D34). Under 768 px
 * this shows a short "open it on a computer" message with a Copy link button instead of
 * the tool; on a wider screen it renders its children.
 */
import { Button, toast } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import * as React from 'react';

const QUERY = '(min-width: 768px)';

/** True on a wide screen. Assumes wide when the browser cannot tell (SSR, old test envs). */
export function useIsWide(): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [wide, setWide] = React.useState(() =>
    supported ? window.matchMedia(QUERY).matches : true,
  );
  React.useEffect(() => {
    if (!supported) return;
    const list = window.matchMedia(QUERY);
    const onChange = () => setWide(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [supported]);
  return wide;
}

/** Copy this page's address, with a translated toast either way. */
export async function copyPageLink(t: TFunction<'printTemplates'>): Promise<void> {
  try {
    await navigator.clipboard.writeText(window.location.href);
    toast.success(t('gate.copied'));
  } catch {
    toast.error(t('gate.copyFailed'));
  }
}

export interface DesktopOnlyGateProps {
  children: React.ReactNode;
  /** Where the back link goes. */
  backTo?: string;
}

export function DesktopOnlyGate({ children, backTo = '/' }: DesktopOnlyGateProps) {
  const { t } = useTranslation('printTemplates');
  const wide = useIsWide();
  if (wide) return <>{children}</>;

  return (
    <div
      role="status"
      data-slot="desktop-only-gate"
      className="mx-auto flex max-w-sm flex-col items-center gap-3 p-8 text-center"
    >
      <h1 className="text-lg font-semibold">{t('gate.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('gate.body')}</p>
      <Button type="button" onClick={() => void copyPageLink(t)}>
        {t('gate.copy')}
      </Button>
      <Link to={backTo} className="text-sm underline underline-offset-4">
        {t('gate.back')}
      </Link>
    </div>
  );
}
