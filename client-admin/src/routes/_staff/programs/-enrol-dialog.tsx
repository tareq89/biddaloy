/**
 * Enrol students into a program — [34.4.1], D16; a full-page modal since 31.4.programs-2b (D21).
 * Class → section selects reuse `useClasses`/`useClassSections`, the same hooks
 * `students/index.tsx`'s filter bar uses, and filter a checkbox list over
 * `useStudents({ class_id, section_id })`.
 *
 * When opened from the list page with no `programId` (D10 palette entry, `?enrol=1` with no
 * program in context), a Program select is shown first; the detail page always passes a real
 * `programId` and never sees it. The component name, props and export are unchanged — the
 * students page mounts it from local state too.
 */
import {
  DatePicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  useClasses,
  useClassSections,
  useEnrolStudents,
  usePrograms,
  useStudents,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { formatNumber, toIsoDate } from '@biddaloy/ui/utils';
import { CircleAlertIcon, InfoIcon } from 'lucide-react';
import * as React from 'react';

import { LabelledField } from './-labelled-field';
import { DiscardConfirm, StudentPickCard } from './-student-pick-card';

export interface EnrolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  programId: string;
  studentIdPrefill?: string | undefined;
  onEnrolled: () => void;
}

export function EnrolDialog({
  open,
  onOpenChange,
  programId,
  studentIdPrefill,
  onEnrolled,
}: EnrolDialogProps) {
  const { t } = useTranslation('programs');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useTenantRegionConfig();

  const initialIds = () => new Set(studentIdPrefill ? [studentIdPrefill] : []);
  const [selectedProgramId, setSelectedProgramId] = React.useState(programId);
  const [classId, setClassId] = React.useState('');
  const [sectionId, setSectionId] = React.useState('');
  const [studentIds, setStudentIds] = React.useState<Set<string>>(initialIds);
  const [startedOn, setStartedOn] = React.useState<Date>(() => new Date());
  const [skipped, setSkipped] = React.useState<number | null>(null);
  const [discardOpen, setDiscardOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setSelectedProgramId(programId);
    setClassId('');
    setSectionId('');
    setStudentIds(new Set(studentIdPrefill ? [studentIdPrefill] : []));
    setStartedOn(new Date());
    setSkipped(null);
    setDiscardOpen(false);
  }, [open, programId, studentIdPrefill]);

  const programsQuery = usePrograms();
  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(classId || undefined);
  const studentsQuery = useStudents(
    {
      ...(classId ? { class_id: classId } : {}),
      ...(sectionId ? { section_id: sectionId } : {}),
      limit: 200,
    },
    { enabled: Boolean(classId) },
  );
  const enrolStudents = useEnrolStudents(selectedProgramId);

  const students = studentsQuery.data?.data ?? [];
  const busy = enrolStudents.isPending;
  const dirty =
    skipped === null &&
    (selectedProgramId !== programId ||
      classId !== '' ||
      sectionId !== '' ||
      studentIds.size !== (studentIdPrefill ? 1 : 0) ||
      toIsoDate(startedOn) !== toIsoDate(new Date()));

  function toggleStudent(id: string) {
    setStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const allSelected = students.every((s) => studentIds.has(s.id));
    setStudentIds(allSelected ? new Set() : new Set(students.map((s) => s.id)));
  }

  function close() {
    if (!busy) onOpenChange(false);
  }

  function submit() {
    if (!selectedProgramId || studentIds.size === 0) return;
    enrolStudents.mutate(
      { student_ids: Array.from(studentIds), started_on: toIsoDate(startedOn) },
      {
        onSuccess: (result) => {
          if (result.skipped > 0) setSkipped(result.skipped);
          else onEnrolled();
        },
      },
    );
  }

  if (!open) return null;

  return (
    <FullPageShell
      title={t('dialogs.enrol.title')}
      onClose={close}
      dirty={dirty}
      primary={{
        label: t('students.enrol'),
        onClick: submit,
        busy,
        disabled: !selectedProgramId || studentIds.size === 0,
      }}
      secondary={{
        label: tCommon('actions.cancel'),
        onClick: () => (busy ? undefined : dirty ? setDiscardOpen(true) : close()),
      }}
    >
      <form
        id="enrol-form"
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <button type="submit" hidden aria-hidden tabIndex={-1} />
        <section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">
          <div className="grid gap-4 md:grid-cols-2">
            {!programId && (
              <LabelledField
                id="enrol-program"
                label={t('dialogs.program')}
                required
                className="md:col-span-2"
              >
                <Select value={selectedProgramId} onValueChange={setSelectedProgramId}>
                  <SelectTrigger id="enrol-program" className="w-full">
                    <SelectValue placeholder={t('dialogs.selectPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(programsQuery.data ?? []).map((program) => (
                      <SelectItem key={program.id} value={program.id}>
                        {program.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </LabelledField>
            )}

            <LabelledField id="enrol-class" label={t('dialogs.enrol.class')} required>
              <Select
                value={classId}
                onValueChange={(value) => {
                  setClassId(value);
                  setSectionId('');
                }}
              >
                <SelectTrigger id="enrol-class" className="w-full">
                  <SelectValue placeholder={t('dialogs.selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {(classesQuery.data?.data ?? []).map((klass) => (
                    <SelectItem key={klass.id} value={klass.id}>
                      {klass.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabelledField>

            <LabelledField id="enrol-section" label={t('dialogs.enrol.section')}>
              <Select value={sectionId} onValueChange={setSectionId}>
                <SelectTrigger id="enrol-section" className="w-full">
                  <SelectValue placeholder={t('dialogs.selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {(sectionsQuery.data ?? []).map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.section_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabelledField>

            <LabelledField id="enrol-started-on" label={t('dialogs.enrol.startedOn')}>
              <DatePicker
                id="enrol-started-on"
                aria-label={t('dialogs.enrol.startedOn')}
                config={regionConfig}
                value={startedOn}
                onValueChange={(d) => d && setStartedOn(d)}
              />
            </LabelledField>
          </div>
        </section>

        <StudentPickCard
          label={t('dialogs.enrol.students')}
          items={students.map((s) => ({ id: s.id, name: s.full_name }))}
          selected={studentIds}
          onToggle={toggleStudent}
          onToggleAll={toggleAll}
          emptyText={t('dialogs.enrol.pickClassFirst')}
        />

        {skipped !== null && (
          <p className="flex items-center gap-1.5 text-text-secondary">
            <InfoIcon aria-hidden className="size-4 shrink-0" />
            {t('dialogs.enrol.skipped', {
              count: skipped,
              n: formatNumber(skipped, regionConfig),
            })}
          </p>
        )}
        {enrolStudents.isError && (
          <p role="alert" className="flex items-center gap-1.5 text-destructive">
            <CircleAlertIcon aria-hidden className="size-4 shrink-0" />
            {t('dialogs.enrol.errorMessage')}
          </p>
        )}
      </form>
      <DiscardConfirm
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onDiscard={() => {
          setDiscardOpen(false);
          close();
        }}
      />
    </FullPageShell>
  );
}
