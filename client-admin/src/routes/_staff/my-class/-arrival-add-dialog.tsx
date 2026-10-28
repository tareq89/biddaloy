/**
 * [84.3.2] "Add yourself": the class teacher turns on arrival notices for a
 * guardian of their own section (D19: created ACTIVE, no request step).
 * Student list = the section roster; guardian list = that student's linked
 * guardians. Opened from the My class card only.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioRows,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@biddaloy/ui/components';
import { useCreateArrivalSubscription, useStudents } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { useRelationshipLabel } from '../students/-detail/relationship-label';

export interface ArrivalAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionId: string;
}

type Mode = 'ONCE' | 'RECURRING';

export function ArrivalAddDialog({ open, onOpenChange, sectionId }: ArrivalAddDialogProps) {
  const { t } = useTranslation('myClass');
  const students = useStudents(
    { section_id: sectionId, sort: 'full_name', limit: 100 },
    { enabled: open },
  );
  const create = useCreateArrivalSubscription();
  const relationshipLabel = useRelationshipLabel();
  const [studentId, setStudentId] = React.useState('');
  const [guardianId, setGuardianId] = React.useState('');
  const [mode, setMode] = React.useState<Mode>('ONCE');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setStudentId('');
    setGuardianId('');
    setMode('ONCE');
    setError(null);
  }, [open]);

  const roster = students.data?.data ?? [];
  const guardians = roster.find((s) => s.id === studentId)?.guardians ?? [];

  function save() {
    setError(null);
    create.mutate(
      { student_id: studentId, guardian_id: guardianId, mode },
      {
        onSuccess: () => {
          toast.success(t('arrival.dialog.added'));
          onOpenChange(false);
        },
        // Rule 23: a fixed sentence, never the server text.
        onError: () => setError(t('arrival.dialog.error')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('arrival.dialog.title')}</DialogTitle>
          <DialogDescription>{t('arrival.dialog.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="arrival-student" className="text-label">
              {t('arrival.dialog.student')}
            </label>
            <Select
              value={studentId}
              onValueChange={(v) => {
                setStudentId(v);
                setGuardianId('');
              }}
            >
              <SelectTrigger id="arrival-student">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roster.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="arrival-guardian" className="text-label">
              {t('arrival.dialog.guardian')}
            </label>
            <Select value={guardianId} onValueChange={setGuardianId} disabled={!studentId}>
              <SelectTrigger id="arrival-guardian">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {guardians.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {`${g.full_name} (${relationshipLabel(g.relationship)})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {studentId && guardians.length === 0 && (
              <p className="text-caption text-text-secondary">{t('arrival.dialog.noGuardians')}</p>
            )}
          </div>
          <RadioRows
            legend={t('arrival.dialog.how')}
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
            options={[
              { value: 'ONCE', title: t('arrival.once'), caption: t('help.arrivalNotice.once') },
              {
                value: 'RECURRING',
                title: t('arrival.everyDay'),
                caption: t('help.arrivalNotice.everyDay'),
              },
            ]}
          />
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('arrival.dialog.cancel')}
          </Button>
          <Button disabled={!studentId || !guardianId || create.isPending} onClick={save}>
            {t('arrival.dialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
