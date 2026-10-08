/**
 * [48.3.A-02] Which admit cards to print: everyone, only those not printed yet, or one section.
 * Shown by `/print/preview` for an exam's admit cards when no students were chosen. Students come
 * in roll order. A full-page modal like the ID-card picker: Close top right, actions in the footer.
 */
import {
  ChoiceCards,
  ErrorState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@biddaloy/ui/components';
import { useAdmitCardRoster } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import * as React from 'react';

export interface AdmitCardPickerProps {
  examId: string;
  onClose: () => void;
  /** Student ids, comma-joined, in roll order. */
  onConfirm: (ids: string) => void;
}

type Choice = 'all' | 'remaining' | 'section';

export function AdmitCardPicker({ examId, onClose, onConfirm }: AdmitCardPickerProps) {
  const { t } = useTranslation('examDocuments');
  const config = useRegionConfig();
  const roster = useAdmitCardRoster(examId);
  const [picked, setPicked] = React.useState<Choice | undefined>(undefined);
  const [section, setSection] = React.useState('');

  const students = [...(roster.data?.students ?? [])].sort(
    (a, b) =>
      (a.section_name ?? '').localeCompare(b.section_name ?? '') || a.roll_number - b.roll_number,
  );
  const remaining = students.filter((s) => s.printed_copies === 0);
  const sectionNames = [...new Set(students.map((s) => s.section_name ?? ''))].filter(Boolean);
  // "Not printed yet" is preselected when anything is left to print.
  const choice: Choice = picked ?? (remaining.length > 0 ? 'remaining' : 'all');

  const chosen =
    choice === 'all'
      ? students
      : choice === 'remaining'
        ? remaining
        : students.filter((s) => s.section_name === section);
  const ready = chosen.length > 0;

  return (
    <FullPageShell
      title={t('admitPicker.title')}
      size="form"
      onClose={onClose}
      secondary={{ label: t('page.close'), onClick: onClose }}
      primary={{
        label: t('admitPicker.next'),
        disabled: !ready,
        onClick: () => onConfirm(chosen.map((s) => s.student_id).join(',')),
      }}
    >
      {roster.isPending ? (
        <Skeleton className="h-40 w-full" aria-busy="true" />
      ) : roster.isError ? (
        <ErrorState message={t('page.loadError')} onRetry={() => void roster.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <ChoiceCards
            label={t('admitPicker.groupLabel')}
            value={choice}
            onValueChange={(v) => setPicked(v as Choice)}
            options={[
              {
                value: 'all',
                title: t('admitPicker.all', {
                  count: students.length,
                  n: formatNumber(students.length, config),
                }),
              },
              {
                value: 'remaining',
                title: t('admitPicker.remaining', {
                  count: remaining.length,
                  n: formatNumber(remaining.length, config),
                }),
              },
              { value: 'section', title: t('admitPicker.section') },
            ]}
          />
          {choice === 'section' ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-label" id="admit-picker-section">
                {t('admitPicker.sectionLabel')}
              </span>
              <Select value={section} onValueChange={setSection}>
                <SelectTrigger aria-labelledby="admit-picker-section" className="w-full">
                  <SelectValue placeholder={t('admitPicker.sectionPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {sectionNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
      )}
    </FullPageShell>
  );
}
