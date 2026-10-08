/** Step 1: Class → Section → Subject → Term. Every field has a visible label. */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useClasses, useClassSections, useSubjects, type AcademicTerm } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { subjectName } from '../../homework/-subject-name';

/** Term option value for a year without terms: saved as `academic_term_id: null` (D14). */
export const WHOLE_YEAR = 'whole-year';

export interface Scope {
  classId: string;
  sectionId: string;
  subjectId: string;
  termId: string;
}

export const emptyScope: Scope = { classId: '', sectionId: '', subjectId: '', termId: '' };

function Field({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const { t } = useTranslation('common');
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label text-text-primary">
        {label}
      </label>
      <Select value={value} onValueChange={onChange} disabled={disabled ?? false}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={t('form.selectPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ScopeStep({
  scope,
  onChange,
  terms,
}: {
  scope: Scope;
  onChange: (next: Scope) => void;
  terms: AcademicTerm[];
}) {
  const { t, i18n } = useTranslation('studyPlans');
  const classes = useClasses();
  const sections = useClassSections(scope.classId || undefined);
  const subjects = useSubjects({ limit: 100 });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field
        id="plan-class"
        label={t('list.filters.class')}
        value={scope.classId}
        // A new class invalidates the section.
        onChange={(classId) => onChange({ ...scope, classId, sectionId: '' })}
        options={(classes.data?.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
      />
      <Field
        id="plan-section"
        label={t('create.section')}
        value={scope.sectionId}
        disabled={!scope.classId}
        onChange={(sectionId) => onChange({ ...scope, sectionId })}
        options={(sections.data ?? []).map((s) => ({ value: s.id, label: s.section_name }))}
      />
      <Field
        id="plan-subject"
        label={t('list.filters.subject')}
        value={scope.subjectId}
        onChange={(subjectId) => onChange({ ...scope, subjectId })}
        options={(subjects.data?.data ?? []).map((s) => ({
          value: s.id,
          label: subjectName(s, i18n.language),
        }))}
      />
      <Field
        id="plan-term"
        label={t('list.filters.term')}
        value={scope.termId}
        onChange={(termId) => onChange({ ...scope, termId })}
        options={
          terms.length > 0
            ? terms.map((x) => ({ value: x.id, label: x.name }))
            : [{ value: WHOLE_YEAR, label: t('list.filters.wholeYear') }]
        }
      />
    </div>
  );
}
