/**
 * [35.4.4/#1284] Platform school-detail "Curriculum preset" danger card.
 * Component only — #1289 mounts it. Not in the palette (D14).
 */
import { Button, Card } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
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
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold">{t('card.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('card.description')}</p>
      <div>
        <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
          {t('card.button')}
        </Button>
      </div>
      <PresetResetDialog
        open={open}
        onOpenChange={setOpen}
        schoolId={schoolId}
        schoolName={schoolName}
      />
    </Card>
  );
}
