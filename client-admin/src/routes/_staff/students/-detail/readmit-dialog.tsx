/**
 * [39.3.2] "Readmit" dialog (D9). Picks a class/section in the active
 * academic year; the server derives the enrollment year from the section.
 * A 409 (e.g. already active) shows inline. Not wired here (#1197).
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DatePicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useClasses,
  useClassSections,
  useReadmitStudent,
  type AcademicYear,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { parseServerDate, toIsoDate } from '@biddaloy/ui/utils';
import * as React from 'react';

import { todayDateInputValue } from './leave-dialog';

export interface ReadmitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  studentName: string;
}

export function ReadmitDialog({ open, onOpenChange, studentId, studentName }: ReadmitDialogProps) {
  const { t } = useTranslation('student-lifecycle');
  const config = useRegionConfig();
  const [occurredOn, setOccurredOn] = React.useState(todayDateInputValue());
  const [classId, setClassId] = React.useState('');
  const [sectionId, setSectionId] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [remark, setRemark] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);

  const yearsQuery = useAcademicYears();
  const currentYear = yearsQuery.data?.data.find((year: AcademicYear) => year.is_current);
  const classesQuery = useClasses(currentYear ? { academic_year_id: currentYear.id } : {}, {
    enabled: open && currentYear !== undefined,
  });
  const sectionsQuery = useClassSections(classId || undefined);
  const readmit = useReadmitStudent(studentId);

  React.useEffect(() => {
    if (open) {
      setOccurredOn(todayDateInputValue());
      setClassId('');
      setSectionId('');
      setReason('');
      setRemark('');
      setSubmitted(false);
      readmit.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open transitions
  }, [open]);

  const dateError =
    occurredOn === ''
      ? t('errors.dateRequired')
      : occurredOn > todayDateInputValue()
        ? t('errors.dateFuture')
        : null;
  const sectionError = sectionId === '' ? t('errors.sectionRequired') : null;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (dateError || sectionError || readmit.isPending) return;
    readmit.mutate(
      {
        occurred_on: occurredOn,
        class_section_id: sectionId,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(remark.trim() ? { remark: remark.trim() } : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Ctrl+Enter bubbles from the focused field */}
        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
          noValidate
        >
          <DialogHeader>
            <DialogTitle>{t('readmit.title')}</DialogTitle>
            <DialogDescription>{t('readmit.description', { name: studentName })}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="readmit-date" className="font-medium">
              {t('readmit.dateLabel')}
            </label>
            <DatePicker
              id="readmit-date"
              aria-label={t('readmit.dateLabel')}
              config={config}
              value={occurredOn ? parseServerDate(occurredOn) : undefined}
              onValueChange={(date) => setOccurredOn(date ? toIsoDate(date) : '')}
              max={new Date()}
              aria-invalid={submitted && dateError !== null}
              aria-describedby={submitted && dateError ? 'readmit-date-error' : undefined}
            />
            {submitted && dateError && (
              <p
                id="readmit-date-error"
                role="alert"
                className="flex items-center gap-1 text-caption text-destructive"
              >
                {dateError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="readmit-class" className="font-medium">
              {t('readmit.classLabel')}
            </label>
            <Select
              value={classId}
              onValueChange={(value) => {
                setClassId(value);
                setSectionId('');
              }}
            >
              <SelectTrigger id="readmit-class" aria-label={t('readmit.classLabel')}>
                <SelectValue placeholder={t('readmit.classPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {classesQuery.data?.data.map((klass) => (
                  <SelectItem key={klass.id} value={klass.id}>
                    {klass.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="readmit-section" className="font-medium">
              {t('readmit.sectionLabel')}
            </label>
            <Select value={sectionId} onValueChange={setSectionId} disabled={!classId}>
              <SelectTrigger
                id="readmit-section"
                aria-label={t('readmit.sectionLabel')}
                aria-invalid={submitted && sectionError !== null}
              >
                <SelectValue placeholder={t('readmit.sectionPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {sectionsQuery.data?.map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.section_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {submitted && sectionError && (
              <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
                {sectionError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="readmit-reason" className="font-medium">
              {t('readmit.reasonLabel')}
            </label>
            <Textarea
              id="readmit-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="readmit-remark" className="font-medium">
              {t('readmit.remarkLabel')}
            </label>
            <Textarea
              id="readmit-remark"
              rows={2}
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
            />
          </div>

          {readmit.isError && (
            <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
              {t('errors.generic')}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" loading={readmit.isPending}>
              {readmit.isPending ? t('readmit.saving') : t('readmit.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
