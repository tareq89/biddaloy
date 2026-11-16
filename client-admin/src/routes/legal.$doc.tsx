import { LegalDocument } from '@biddaloy/shared';
import { AuthLayout } from '@biddaloy/ui/components';
import { useLocale } from '@biddaloy/ui/i18n';
import { createFileRoute, notFound } from '@tanstack/react-router';
import * as React from 'react';

import { getLegalDoc, type LegalLang } from '../features/legal/legal-docs';
import { LegalMarkdown } from '../features/legal/legal-markdown';

// ponytail: in-folder bn/en labels like the legal kit; move to t('legal:...') once 59.2.05 keys land.
const TITLES: Record<LegalLang, Record<LegalDocument, string>> = {
  bn: {
    [LegalDocument.TERMS]: 'শর্তাবলি',
    [LegalDocument.PRIVACY]: 'গোপনীয়তা নীতি',
    [LegalDocument.DPA]: 'তথ্য চুক্তি',
    [LegalDocument.SLA]: 'সেবা চুক্তি',
  },
  en: {
    [LegalDocument.TERMS]: 'Terms',
    [LegalDocument.PRIVACY]: 'Privacy policy',
    [LegalDocument.DPA]: 'Data agreement',
    [LegalDocument.SLA]: 'Service agreement',
  },
};

const isLegalDocument = (v: string): v is LegalDocument =>
  (Object.values(LegalDocument) as string[]).includes(v);

export const Route = createFileRoute('/legal/$doc')({
  // An unknown `doc` renders the root's 404 page.
  beforeLoad: ({ params }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (!isLegalDocument(params.doc)) throw notFound();
  },
  component: LegalDocPage,
});

function LegalDocPage() {
  const doc = Route.useParams().doc as LegalDocument;
  const { locale } = useLocale();
  // The language switch is the one in `AuthLayout`'s corner; it changes the app locale.
  const lang: LegalLang = locale === 'bn' ? 'bn' : 'en';
  const title = TITLES[lang][doc];

  // `useRouteFocus` retitles from the page's own <h1> ("Terms of Service · SchoolManager"); keep ours.
  React.useEffect(() => {
    const want = `${title} · SchoolManagerP`;
    const apply = () => {
      if (document.title !== want) document.title = want;
    };
    apply();
    const observer = new MutationObserver(apply);
    const el = document.querySelector('title');
    if (el) observer.observe(el, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [title]);

  return (
    <AuthLayout size="wide">
      <article lang={lang} className="flex flex-col gap-3">
        <h1 className="sr-only">{title}</h1>
        <LegalMarkdown source={getLegalDoc(doc, lang).body} />
      </article>
    </AuthLayout>
  );
}
