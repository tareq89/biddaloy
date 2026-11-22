import { LegalDocument } from '@biddaloy/shared';
import { AuthLayout, Button, Checkbox, Label, NoticeBar } from '@biddaloy/ui/components';
import { useLocale } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { LegalDocumentsDialog } from '../features/legal/legal-documents-dialog';
import { legalStatusQuery, useAcceptLegal } from '../features/legal/use-legal-status';
import { isSameAppRedirect } from '../same-app-redirect';

// ponytail: in-folder bn/en labels like the legal kit; move to legal-namespace keys once 59.2.05 keys land.
const TEXT = {
  bn: {
    title: 'শর্তাবলি পড়ে সম্মত হন',
    intro: 'এগিয়ে যাওয়ার আগে নিচের নথিগুলো পড়ুন।',
    agree: 'আমি পড়েছি এবং সম্মত',
    submit: 'সম্মত হয়ে এগিয়ে যান',
    error: 'সম্মতি জমা হয়নি। আবার চেষ্টা করুন।',
    loadError: 'নথির তালিকা আনা যায়নি।',
    retry: 'আবার চেষ্টা করুন',
    docs: {
      [LegalDocument.TERMS]: 'শর্তাবলি',
      [LegalDocument.PRIVACY]: 'গোপনীয়তা নীতি',
      [LegalDocument.DPA]: 'তথ্য চুক্তি',
      [LegalDocument.SLA]: 'সেবা চুক্তি',
    },
  },
  en: {
    title: 'Read and agree to continue',
    intro: 'Please read these documents before you go on.',
    agree: 'I have read and agree',
    submit: 'Agree and continue',
    error: 'Your agreement was not saved. Try again.',
    loadError: 'Could not load the documents.',
    retry: 'Try again',
    docs: {
      [LegalDocument.TERMS]: 'Terms',
      [LegalDocument.PRIVACY]: 'Privacy policy',
      [LegalDocument.DPA]: 'Data agreement',
      [LegalDocument.SLA]: 'Service agreement',
    },
  },
};

const searchSchema = z.object({
  redirect: z.string().refine(isSameAppRedirect).optional().catch(undefined),
});

export const Route = createFileRoute('/legal/accept')({
  validateSearch: searchSchema,
  component: LegalAcceptPage,
});

function LegalAcceptPage() {
  const { locale } = useLocale();
  const text = TEXT[locale === 'bn' ? 'bn' : 'en'];
  const search = Route.useSearch();
  const router = useRouter();
  const status = useQuery(legalStatusQuery);
  const accept = useAcceptLegal();
  const [checked, setChecked] = React.useState(false);
  const [reading, setReading] = React.useState<LegalDocument | null>(null);
  const pending = (status.data?.pending ?? []) as LegalDocument[];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!checked || pending.length === 0) return;
    accept.mutate(pending);
  }

  // Nothing owed (accepted just now, or opened by hand): carry on to where they were going.
  React.useEffect(() => {
    if (status.data && status.data.pending.length === 0) {
      router.history.push(search.redirect ?? '/');
    }
  }, [status.data, search.redirect, router]);

  return (
    <AuthLayout>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h1 className="text-h3 font-semibold">{text.title}</h1>
        <p className="text-text-muted text-body">{text.intro}</p>
        <ul className="flex flex-col gap-1">
          {pending.map((d) => (
            <li key={d}>
              <Button type="button" variant="link" className="px-0" onClick={() => setReading(d)}>
                {text.docs[d]}
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Checkbox
            id="legal-agree"
            checked={checked}
            onCheckedChange={(v) => setChecked(v === true)}
          />
          <Label htmlFor="legal-agree">{text.agree}</Label>
        </div>
        {status.isError && (
          <NoticeBar tone="danger">
            {text.loadError}{' '}
            <Button
              type="button"
              variant="link"
              className="px-0"
              onClick={() => void status.refetch()}
            >
              {text.retry}
            </Button>
          </NoticeBar>
        )}
        {accept.isError && <NoticeBar tone="danger">{text.error}</NoticeBar>}
        <Button type="submit" disabled={!checked || accept.isPending || pending.length === 0}>
          {text.submit}
        </Button>
      </form>
      {reading && (
        <LegalDocumentsDialog
          open
          onOpenChange={(o) => !o && setReading(null)}
          docs={pending}
          initialDoc={reading}
          onAgree={() => {
            setChecked(true);
            setReading(null);
          }}
        />
      )}
    </AuthLayout>
  );
}
