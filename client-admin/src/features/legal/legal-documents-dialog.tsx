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
import { useLocale, useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { getLegalDoc, type LegalLang } from './legal-docs';
import { LegalMarkdown } from './legal-markdown';

export interface LegalDocumentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docs: readonly LegalDocument[];
  onAgree: () => void;
  /** Tab shown first; defaults to the first of `docs`. */
  initialDoc?: LegalDocument | undefined;
  /** Where focus lands after close; defaults to whatever opened the dialog. */
  returnFocusTo?: () => HTMLElement | null;
}

/** D40: the three plain-words lines open each tab, so drop the same list the Markdown repeats under "In short". */
const IN_SHORT = /^##\s+(?:In short|সারসংক্ষেপ)\s*\r?\n(?:\s*-.*\r?\n?)+/m;
const SUMMARY_LINES = ['1', '2', '3'] as const;

export function LegalDocumentsDialog({
  open,
  onOpenChange,
  docs,
  onAgree,
  initialDoc,
  returnFocusTo,
}: LegalDocumentsDialogProps) {
  const { locale } = useLocale();
  const [override, setOverride] = React.useState<LegalLang | null>(null);
  const lang: LegalLang = override ?? (locale === 'bn' ? 'bn' : 'en');
  const { t } = useTranslation('legal', { lng: lang });
  // Radix only refocuses a DialogTrigger; this dialog is controlled, so remember the opener ourselves (21-ui-patterns §14).
  const opener = React.useRef<HTMLElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        fullScreenOnPhone
        closeLabel={t('dialog.close')}
        lang={lang}
        onOpenAutoFocus={() => {
          opener.current = document.activeElement as HTMLElement | null;
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          (returnFocusTo?.() ?? opener.current)?.focus();
        }}
      >
        <DialogHeader className="flex-row items-center justify-between gap-2 pe-10">
          <DialogTitle>{t('dialog.title')}</DialogTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOverride(lang === 'bn' ? 'en' : 'bn')}
          >
            {t('dialog.switchTo')}
          </Button>
        </DialogHeader>
        <Tabs defaultValue={initialDoc ?? docs[0]} className="min-h-0 flex-1">
          <TabsList variant="line">
            {docs.map((d) => (
              <TabsTrigger key={d} value={d}>
                {t(`docs.${d}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {docs.map((d) => (
            <TabsContent key={d} value={d} className="min-h-0 overflow-y-auto">
              <ul className="mb-4 list-disc space-y-1 ps-5 text-body" data-testid="legal-summary">
                {SUMMARY_LINES.map((n) => (
                  <li key={n}>{t(`summary.${d}.${n}`)}</li>
                ))}
              </ul>
              <LegalMarkdown source={getLegalDoc(d, lang).body.replace(IN_SHORT, '')} />
            </TabsContent>
          ))}
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('dialog.close')}
          </Button>
          <Button onClick={onAgree}>{t('dialog.agree')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
