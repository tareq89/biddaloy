/**
 * Merit certificate chooser — [48.3.A-02], D29. Rank by class or section, take the top N, see
 * how many students that is, then go to the print preview with exactly those students.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  RadioGroup,
  RadioGroupItem,
} from '@biddaloy/ui/components';
import { useMeritCandidates, type MeritScope } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useRouter } from '@tanstack/react-router';
import * as React from 'react';

import { examPreviewHref } from '../../../../components/print/exam-preview-href';

export interface MeritDialogProps {
  examId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MeritDialog({ examId, open, onOpenChange }: MeritDialogProps) {
  const { t } = useTranslation('examDocuments');
  const config = useRegionConfig();
  const router = useRouter();
  const [scope, setScope] = React.useState<MeritScope>('CLASS');
  const [topText, setTopText] = React.useState('3');
  const top = Number(topText);
  const valid = Number.isInteger(top) && top >= 1 && top <= 50;
  const candidates = useMeritCandidates(open && valid ? examId : undefined, { scope, top });
  const list = candidates.data ?? [];

  const next = () => {
    const ids = list.map((c) => c.student_id).join(',');
    onOpenChange(false);
    router.history.push(examPreviewHref(examId, 'MERIT_CERTIFICATE', { ids }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('merit.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('meritCertificate.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-label" id="merit-scope">
              {t('merit.scope')}
            </p>
            <RadioGroup
              aria-labelledby="merit-scope"
              value={scope}
              onValueChange={(v) => setScope(v as MeritScope)}
              className="mt-1.5 grid gap-2"
            >
              {(['CLASS', 'SECTION'] as const).map((value) => (
                <label key={value} className="flex min-h-11 items-center gap-3 md:min-h-8">
                  <RadioGroupItem value={value} />
                  {t(value === 'CLASS' ? 'merit.scopeClass' : 'merit.scopeSection')}
                </label>
              ))}
            </RadioGroup>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="merit-top" className="text-label">
              {t('merit.topLabel')}
            </label>
            <Input
              id="merit-top"
              type="number"
              min={1}
              max={50}
              value={topText}
              onChange={(e) => setTopText(e.target.value)}
              aria-invalid={!valid}
            />
          </div>
          <p role="status" className="text-text-secondary">
            {valid && !candidates.isPending
              ? t('merit.count', { count: list.length, n: formatNumber(list.length, config) })
              : ''}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('page.close')}
          </Button>
          <Button type="button" disabled={!valid || list.length === 0} onClick={next}>
            {t('merit.continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
