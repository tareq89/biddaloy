/**
 * Step 2, first card: "who is this for?". Student types need a student and an applicant
 * (a guardian or the student with a login, or a typed name when nobody has one, D46); staff
 * types default to the user's own profile, and `APPLICATION_MANAGE` can write another
 * staff member's paper application.
 */
import {
  Card,
  Checkbox,
  Combobox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useDebouncedValue, useStudentSearch, useUsers } from '@biddaloy/ui/hooks';
import type { StaffUser, Student } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

/** The applicant select's value for "nobody has a login: type the name". */
export const NO_LOGIN = '__no_login__';
const NAME_MAX = 150;

export interface SubjectState {
  /** ID card reprint and general letters fit a student too: `APPLICATION_MANAGE` can switch. */
  forStudent: boolean;
  studentId: string;
  /** A user id, `NO_LOGIN`, or `''`. */
  applicant: string;
  applicantName: string;
  paperStaff: boolean;
  staffUserId: string;
}

export const EMPTY_SUBJECT: SubjectState = {
  forStudent: false,
  studentId: '',
  applicant: '',
  applicantName: '',
  paperStaff: false,
  staffUserId: '',
};

export type SubjectKind = 'STUDENT' | 'STAFF';

/** Translated-key map of what is wrong; empty when the card is complete. */
export function subjectErrors(
  kind: SubjectKind,
  s: SubjectState,
  student: Student | undefined,
  staffUser: StaffUser | undefined,
): Partial<Record<'student' | 'applicant' | 'applicantName' | 'staff', string>> {
  if (kind === 'STUDENT') {
    if (!s.studentId || !student) return { student: 'studentRequired' };
    if (!s.applicant) return { applicant: 'applicantRequired' };
    if (s.applicant === NO_LOGIN) {
      const name = s.applicantName.trim();
      if (!name) return { applicantName: 'applicantNameRequired' };
      if (name.length > NAME_MAX) return { applicantName: 'applicantNameTooLong' };
    }
    return {};
  }
  if (s.paperStaff) {
    if (!s.staffUserId) return { staff: 'staffRequired' };
    if (!staffUser?.staff_profile_id) return { staff: 'noProfile' };
  }
  return {};
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-caption text-destructive">
      {message}
    </p>
  );
}

/** Tenant staff who have a staff profile. The list is local-filtered: 100 is the ceiling. */
export function StaffCombobox({
  id,
  value,
  onChange,
  label,
  invalid,
  describedBy,
}: {
  id?: string;
  value: string;
  onChange: (userId: string) => void;
  label: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const users = useUsers({ limit: 100, sort: 'full_name' });
  const options = (users.data?.data ?? [])
    .filter((u) => u.staff_profile_id)
    .map((u) => ({ value: u.id, label: u.full_name }));
  return (
    <Combobox
      id={id}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      options={options}
      value={value || null}
      onValueChange={(v) => onChange(v ?? '')}
    />
  );
}

function StudentPicker({
  student,
  onPick,
  error,
}: {
  student: Student | undefined;
  onPick: (id: string) => void;
  error: string | undefined;
}) {
  const { t } = useTranslation('applicationsNew');
  const [search, setSearch] = React.useState('');
  const debounced = useDebouncedValue(search, 300);
  const results = useStudentSearch(
    { search: debounced, limit: 8 },
    { enabled: debounced.trim() !== '' },
  );
  if (student) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {student.full_name} · {student.class_section.class.name} ·{' '}
          {student.class_section.section_name}
        </span>
        <button type="button" className="text-label underline" onClick={() => onPick('')}>
          {t('subject.studentChange')}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="new-app-student">{t('subject.student')}</Label>
      <Input
        id="new-app-student"
        value={search}
        placeholder={t('subject.studentSearch')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'new-app-student-error' : undefined}
        onChange={(event) => setSearch(event.target.value)}
      />
      {debounced.trim() !== '' && (results.data?.data.length ?? 0) > 0 && (
        <ul
          className="divide-y divide-border-subtle rounded-lg border border-border-subtle"
          aria-live="polite"
        >
          {results.data?.data.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="min-h-11 w-full px-3 text-start hover:bg-secondary"
                onClick={() => onPick(s.id)}
              >
                {s.full_name} · {s.class_section.class.name} · {s.class_section.section_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <FieldError id="new-app-student-error" message={error} />
    </div>
  );
}

export interface SubjectCardProps {
  kind: SubjectKind;
  state: SubjectState;
  onChange: (patch: Partial<SubjectState>) => void;
  student: Student | undefined;
  canManage: boolean;
  hasProfile: boolean;
  /** The type accepts a student or a staff member as its subject. */
  dual: boolean;
  showErrors: boolean;
  errors: ReturnType<typeof subjectErrors>;
}

export function SubjectCard({
  kind,
  state,
  onChange,
  student,
  canManage,
  hasProfile,
  dual,
  showErrors,
  errors,
}: SubjectCardProps) {
  const { t } = useTranslation('applicationsNew');
  const forStudentToggle =
    dual && canManage ? (
      <div className="flex items-center gap-2">
        <Checkbox
          id="new-app-for-student"
          checked={state.forStudent}
          onCheckedChange={(v) => onChange({ forStudent: v === true })}
        />
        <Label htmlFor="new-app-for-student">{t('subject.forStudent')}</Label>
      </div>
    ) : null;
  const err = (key: keyof typeof errors) =>
    showErrors && errors[key] ? t(`subject.${errors[key]}`) : undefined;

  if (kind === 'STAFF') {
    // No own profile: the only way to file is on behalf of someone else.
    const paper = state.paperStaff || !hasProfile;
    return (
      <Card padded className="flex flex-col gap-3">
        <h2 className="text-h3">{t('subject.heading')}</h2>
        {forStudentToggle}
        {!paper && <p>{t('subject.self')}</p>}
        {canManage && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="new-app-paper-staff"
              checked={paper}
              disabled={!hasProfile}
              onCheckedChange={(v) => onChange({ paperStaff: v === true })}
            />
            <Label htmlFor="new-app-paper-staff">{t('subject.paperStaff')}</Label>
          </div>
        )}
        {paper && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-app-staff">{t('subject.staff')}</Label>
            <StaffCombobox
              id="new-app-staff"
              value={state.staffUserId}
              onChange={(staffUserId) => onChange({ staffUserId })}
              label={t('subject.staff')}
              invalid={!!err('staff')}
              {...(err('staff') ? { describedBy: 'new-app-staff-error' } : {})}
            />
            <FieldError id="new-app-staff-error" message={err('staff')} />
            <p className="text-caption text-text-secondary">{t('subject.paperNote')}</p>
          </div>
        )}
      </Card>
    );
  }

  const applicants = student
    ? [
        ...student.guardians
          .filter((g) => g.user_id)
          .map((g) => ({
            value: g.user_id as string,
            label: `${g.full_name} (${g.relationship})`,
          })),
        ...(student.user_id
          ? [
              {
                value: student.user_id,
                label: t('subject.studentThemselves', { name: student.full_name }),
              },
            ]
          : []),
      ]
    : [];

  return (
    <Card padded className="flex flex-col gap-3">
      <h2 className="text-h3">{t('subject.heading')}</h2>
      {forStudentToggle}
      <StudentPicker
        student={student}
        onPick={(studentId) => onChange({ studentId, applicant: '', applicantName: '' })}
        error={err('student')}
      />
      {student && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-app-applicant">{t('subject.applicant')}</Label>
          <Select value={state.applicant} onValueChange={(applicant) => onChange({ applicant })}>
            <SelectTrigger
              id="new-app-applicant"
              aria-invalid={err('applicant') ? true : undefined}
              aria-describedby={err('applicant') ? 'new-app-applicant-error' : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {applicants.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
              <SelectItem value={NO_LOGIN}>{t('subject.applicantNoLogin')}</SelectItem>
            </SelectContent>
          </Select>
          <FieldError id="new-app-applicant-error" message={err('applicant')} />
        </div>
      )}
      {student && state.applicant === NO_LOGIN && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-app-applicant-name">{t('subject.applicantName')}</Label>
          <Input
            id="new-app-applicant-name"
            value={state.applicantName}
            maxLength={NAME_MAX}
            aria-invalid={err('applicantName') ? true : undefined}
            aria-describedby="new-app-applicant-name-error"
            onChange={(event) => onChange({ applicantName: event.target.value })}
          />
          <FieldError id="new-app-applicant-name-error" message={err('applicantName')} />
        </div>
      )}
      <p className="text-caption text-text-secondary">{t('subject.paperNote')}</p>
    </Card>
  );
}
