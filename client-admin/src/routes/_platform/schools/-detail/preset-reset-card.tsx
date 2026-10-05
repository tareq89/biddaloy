/**
 * [35.4.4/#1284] Platform school-detail "Curriculum preset" danger card.
 * Component only — #1289 mounts it. Not in the palette (D14).
 */
import { Button, Card } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Undo2Icon } from 'lucide-react';
import * as React from 'react';

import { PresetResetDialog } from './preset-reset-dialog';

export interface ResetPresetCardProps {
  schoolId: string;
  schoolName: string;
}

export function ResetPresetCard({ schoolId, schoolName }: ResetPresetCardProps) {
  const { t } = useTranslation('presetReset');
  const [open, setOpen] = React.useState(false);

  return (
    <Card padded>
      <h2 className="text-h2">{t('card.title')}</h2>
      <p className="mt-1 text-text-secondary">{t('card.description')}</p>
      <Button type="button" variant="destructive" className="mt-4" onClick={() => setOpen(true)}>
        <Undo2Icon aria-hidden="true" />
        {t('card.button')}
      </Button>
      <PresetResetDialog
        open={open}
        onOpenChange={setOpen}
        schoolId={schoolId}
        schoolName={schoolName}
      />
    </Card>
  );
}
