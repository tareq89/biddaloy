/**
 * [27.8] Shown right after a successful submit — the reference number is
 * the one thing a guardian needs to write down/screenshot before leaving
 * the page, so it's rendered large and has a copy button (clipboard write
 * plus a plain visible fallback for a browser/context that blocks it).
 */
import { Button, Card } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

export interface AdmissionConfirmationProps {
  slug: string;
  referenceNumber: string;
}

export function AdmissionConfirmation({ slug, referenceNumber }: AdmissionConfirmationProps) {
  const { t } = useTranslation('admission-public');
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(referenceNumber);
      setCopied(true);
    } catch {
      // Clipboard access can be denied/unavailable — the number is already
      // shown large on screen, so this is a nice-to-have, not required.
    }
  }

  return (
    <Card className="flex flex-col items-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">{t('confirmation.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('confirmation.explanation')}</p>
      <p
        className="rounded-md border border-border bg-muted/40 px-4 py-3 text-2xl font-bold tracking-wide"
        data-testid="reference-number"
      >
        {referenceNumber}
      </p>
      <Button type="button" variant="outline" onClick={() => void handleCopy()}>
        {copied ? t('confirmation.copied') : t('confirmation.copy')}
      </Button>
      <Link
        to="/admission/$slug/status"
        params={{ slug }}
        search={{ referenceNumber }}
        className="text-sm font-medium text-primary underline underline-offset-4"
      >
        {t('confirmation.checkStatusLink')}
      </Link>
    </Card>
  );
}
