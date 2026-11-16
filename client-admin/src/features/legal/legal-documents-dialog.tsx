/**
 * [59.2.06] Read the legal texts in a dialog: one tab per doc in `docs`, a one-click
 * bn/en switch (D41), and an "Agree" button that is enabled from the start (D40).
 * The service agreement is a section inside Terms, so callers pass terms/privacy/dpa.
 */
import { LegalDocument } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@biddaloy/ui/components';
import { useLocale } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { getLegalDoc, type LegalLang } from './legal-docs';
import { LegalMarkdown } from './legal-markdown';

// ponytail: in-folder fallback; the `legal` i18n keys of 59.2.05 are not on this branch. Move to t() once they land.
const TEXT: Record<
  LegalLang,
  {
    title: string;
    close: string;
    agree: string;
    switchTo: string;
    docs: Record<LegalDocument, string>;
  }
> = {
  bn: {
    title: 'আইনি নথি',
    close: 'বন্ধ করুন',
    agree: 'সম্মত',
    switchTo: 'English',
    docs: {
      [LegalDocument.TERMS]: 'শর্তাবলি',
      [LegalDocument.PRIVACY]: 'গোপনীয়তা নীতি',
      [LegalDocument.DPA]: 'তথ্য চুক্তি',
      [LegalDocument.SLA]: 'সেবা চুক্তি',
    },
  },
  en: {
    title: 'Legal documents',
    close: 'Close',
    agree: 'Agree',
    switchTo: 'বাংলা',
    docs: {
      [LegalDocument.TERMS]: 'Terms',
      [LegalDocument.PRIVACY]: 'Privacy',
      [LegalDocument.DPA]: 'Data agreement',
      [LegalDocument.SLA]: 'Service agreement',
    },
  },
};

export interface LegalDocumentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docs: readonly LegalDocument[];
  onAgree: () => void;
  /** Tab shown first; defaults to the first of `docs`. */
  initialDoc?: LegalDocument;
}

export function LegalDocumentsDialog({
  open,
  onOpenChange,
  docs,
  onAgree,
  initialDoc,
}: LegalDocumentsDialogProps) {
  const { locale } = useLocale();
  const [override, setOverride] = React.useState<LegalLang | null>(null);
  const lang: LegalLang = override ?? (locale === 'bn' ? 'bn' : 'en');
  const text = TEXT[lang];
  // Radix only refocuses a DialogTrigger; this dialog is controlled, so remember the opener ourselves (21-ui-patterns §14).
  const opener = React.useRef<HTMLElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        fullScreenOnPhone
        closeLabel={text.close}
        lang={lang}
        onOpenAutoFocus={() => {
          opener.current = document.activeElement as HTMLElement | null;
        }}
        onCloseAutoFocus={() => opener.current?.focus()}
      >
        <DialogHeader className="flex-row items-center justify-between gap-2 pe-10">
          <DialogTitle>{text.title}</DialogTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOverride(lang === 'bn' ? 'en' : 'bn')}
          >
            {text.switchTo}
          </Button>
        </DialogHeader>
        <Tabs defaultValue={initialDoc ?? docs[0]} className="min-h-0 flex-1">
          <TabsList variant="line">
            {docs.map((d) => (
              <TabsTrigger key={d} value={d}>
                {text.docs[d]}
              </TabsTrigger>
            ))}
          </TabsList>
          {docs.map((d) => (
            <TabsContent key={d} value={d} className="min-h-0 overflow-y-auto">
              <LegalMarkdown source={getLegalDoc(d, lang).body} />
            </TabsContent>
          ))}
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {text.close}
          </Button>
          <Button onClick={onAgree}>{text.agree}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
