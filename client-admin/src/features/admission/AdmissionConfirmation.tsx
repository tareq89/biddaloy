/**
 * [27.8] Shown right after a successful submit — the reference number is
 * the one thing a guardian needs to write down/screenshot before leaving
 * the page, so it's rendered large and has a copy button (clipboard write
 * plus a plain visible fallback for a browser/context that blocks it).
 */
import { Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import { CheckIcon, CircleCheckIcon, CopyIcon } from 'lucide-react';
import * as React from 'react';

export interface AdmissionConfirmationProps {
  slug: string;
  referenceNumber: string;
}

export function AdmissionConfirmation({ slug, referenceNumber }: AdmissionConfirmationProps) {
  const { t } = useTranslation('admission-public');
  const [copied, setCopied] = React.useState(false);
  const [copyFailed, setCopyFailed] = React.useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(referenceNumber);
      setCopied(true);
    } catch {
      // Clipboard access can be denied/unavailable: tell the parent to copy by hand.
      setCopyFailed(true);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-status-paid-bg text-status-paid-fg">
        <CircleCheckIcon aria-hidden />
      </span>
      <h1 className="text-h1">{t('confirmation.title')}</h1>
      <p className="text-text-secondary">{t('confirmation.explanation')}</p>
      <p
        className="w-full rounded-md bg-muted px-4 py-3 text-h1 tracking-wide"
        data-testid="reference-number"
      >
        {referenceNumber}
      </p>
      <Button type="button" variant="outline" className="w-full" onClick={() => void handleCopy()}>
        {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
        {copied ? t('confirmation.copied') : t('confirmation.copy')}
      </Button>
      {copyFailed && (
        <p role="status" className="text-caption text-text-secondary">
          {t('confirmation.clipboardHint')}
        </p>
      )}
      <Link
        to="/admission/$slug/status"
        params={{ slug }}
        search={{ referenceNumber }}
        className="inline-flex h-11 items-center rounded-md px-3 font-medium text-primary hover:bg-muted"
      >
        {t('confirmation.checkStatusLink')}
      </Link>
    </div>
  );
}
