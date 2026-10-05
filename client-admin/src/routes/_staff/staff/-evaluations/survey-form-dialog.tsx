/**
 * [28.4.2] The one "New teacher survey" form, a `FullPageShell` overlaid on
 * the evaluations page while `?publishSurvey=1` is in the URL (the palette
 * opens it the same way). Defaults make the common case short: three template
 * questions with stars on, anonymous, students and guardians, minimum 3.
 * Validation is on submit; each error sits under its own control, with one
 * visually hidden `role="alert"` summary for screen readers.
 * Ctrl/Cmd+Enter saves as a draft; "Save and publish" is a separate button.
 *
 * "Anonymous" is a management-visibility label only: the copy says answers are
 * hidden from management, never that they are untraceable.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  Combobox,
  DatePicker,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@biddaloy/ui/components';
import {
  useAllSubjects,
  useAllTeachers,
  useCreateSurvey,
  usePublishSurvey,
  useUpdateSurvey,
  type SurveyRespondent,
} from '@biddaloy/ui/hooks';
import { useLocale, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { formatNumber, parseDate, toIsoDate } from '@biddaloy/ui/utils';
import { CircleAlertIcon, CircleMinusIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

const RESPONDENTS: SurveyRespondent[] = ['BOTH', 'STUDENTS', 'GUARDIANS'];
const MIN_RESPONSES = 3;
const TEMPLATE_KEYS = ['clear', 'respect', 'help'] as const;

const CARD = 'rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5';
const HELP = 'mt-0.5 text-text-secondary';
const INVALID = 'border-destructive';

interface TargetRow {
  key: number;
  teacherId: string | null;
  subjectId: string | null;
}
interface QuestionRow {
  key: number;
  text: string;
  stars: boolean;
}
type FieldErrors = Partial<Record<'title' | 'targets' | 'questions' | 'min' | 'dates', string>>;

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="flex items-center gap-1 text-caption text-destructive">
      <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}

function Req({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('evaluations');
  return (
    <>
      {children}
      <span className="text-destructive" aria-hidden="true">
        *
      </span>
      <span className="sr-only">{t('form.required', { ns: 'common' })}</span>
    </>
  );
}

export function SurveyFormPage({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('evaluations');
  const { locale } = useLocale();
  const regionConfig = useTenantRegionConfig();
  const create = useCreateSurvey();
  const publish = usePublishSurvey();
  const update = useUpdateSurvey();
  const teachers = useAllTeachers();
  const subjects = useAllSubjects();
  const nextKey = React.useRef(0);
  const createdId = React.useRef<string | null>(null);
  const newKey = () => nextKey.current++;

  const [title, setTitle] = React.useState('');
  const [anonymous, setAnonymous] = React.useState(true);
  const [respondent, setRespondent] = React.useState<SurveyRespondent>('BOTH');
  const [targets, setTargets] = React.useState<TargetRow[]>(() => [
    { key: newKey(), teacherId: null, subjectId: null },
  ]);
  // Template set: the common case is "accept and go".
  const [questions, setQuestions] = React.useState<QuestionRow[]>(() =>
    TEMPLATE_KEYS.map((k) => ({
      key: newKey(),
      text: t(`surveys.form.templateQuestions.${k}`),
      stars: true,
    })),
  );
  const [opensAt, setOpensAt] = React.useState('');
  const [closesAt, setClosesAt] = React.useState('');
  const [minResponses, setMinResponses] = React.useState(String(MIN_RESPONSES));
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [rowErrors, setRowErrors] = React.useState<Record<number, string>>({});
  const [questionErrors, setQuestionErrors] = React.useState<Record<number, string>>({});
  const [targetsServerError, setTargetsServerError] = React.useState<string | null>(null);

  const snapshot = (
    ti: string,
    an: boolean,
    re: SurveyRespondent,
    ta: TargetRow[],
    qu: QuestionRow[],
    op: string,
    cl: string,
    mi: string,
  ) =>
    JSON.stringify([
      ti,
      an,
      re,
      ta.map((r) => [r.teacherId, r.subjectId]),
      qu.map((q) => [q.text, q.stars]),
      op,
      cl,
      mi,
    ]);
  const initial = React.useRef<string | null>(null);
  initial.current ??= snapshot(
    '',
    true,
    'BOTH',
    [{ key: 0, teacherId: null, subjectId: null }],
    questions,
    '',
    '',
    String(MIN_RESPONSES),
  );
  const dirty =
    snapshot(title, anonymous, respondent, targets, questions, opensAt, closesAt, minResponses) !==
    initial.current;

  const teacherOptions = (teachers.data ?? []).map((x) => ({
    value: x.id,
    label: `${x.user.full_name} (${x.employee_id})`,
  }));
  const subjectOptions = (subjects.data ?? []).map((x) => ({
    value: x.id,
    label: `${locale === 'bn' && x.name_bn ? x.name_bn : x.name_en} (${x.code})`,
  }));

  const patchTarget = (key: number, patch: Partial<TargetRow>) =>
    setTargets((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const patchQuestion = (key: number, patch: Partial<QuestionRow>) =>
    setQuestions((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function validate() {
    const next: FieldErrors = {};
    const rows: Record<number, string> = {};
    const qs: Record<number, string> = {};
    let firstId: string | null = null;
    const flag = (id: string) => {
      firstId ??= id;
    };
    if (!title.trim()) {
      next.title = t('surveys.form.errorTitle');
      flag('survey-title');
    }
    const seen = new Set<string>();
    for (const r of targets) {
      if (!r.teacherId) {
        rows[r.key] = t('surveys.form.errorRowTeacher');
        flag(`survey-teacher-${r.key}`);
      } else if (!r.subjectId) {
        rows[r.key] = t('surveys.form.errorRowSubject');
        flag(`survey-subject-${r.key}`);
      } else {
        const pair = `${r.teacherId}:${r.subjectId}`;
        if (seen.has(pair)) {
          rows[r.key] = t('surveys.form.errorDuplicateTarget');
          flag(`survey-subject-${r.key}`);
        }
        seen.add(pair);
      }
    }
    if (targets.length === 0) next.targets = t('surveys.form.errorTargets');
    if (questions.length === 0) next.questions = t('surveys.form.errorQuestions');
    for (const q of questions) {
      if (!q.text.trim()) {
        qs[q.key] = t('surveys.form.errorQuestionText');
        flag(`survey-q-${q.key}`);
      }
    }
    if (!(Number(minResponses) >= MIN_RESPONSES)) {
      next.min = t('surveys.form.errorMin');
      flag('survey-min');
    }
    if (opensAt && closesAt && closesAt <= opensAt) {
      next.dates = t('surveys.form.errorDates');
      flag('survey-closes');
    }
    return { next, rows, qs, firstId: firstId as string | null };
  }

  async function submit(andPublish: boolean) {
    const { next, rows, qs, firstId } = validate();
    setErrors(next);
    setRowErrors(rows);
    setQuestionErrors(qs);
    setTargetsServerError(null);
    const count = Object.keys(next).length + Object.keys(rows).length + Object.keys(qs).length;
    if (count > 0) {
      // Focus the first invalid control once React has rendered the messages.
      if (firstId) requestAnimationFrame(() => document.getElementById(firstId)?.focus());
      return;
    }
    try {
      const body = {
        title: title.trim(),
        anonymous,
        respondent,
        minResponses: Number(minResponses),
        questions: questions.map((q) => ({ text: q.text.trim(), starsEnabled: q.stars })),
        targets: targets.map((r) => ({ teacherId: r.teacherId!, subjectId: r.subjectId! })),
        ...(opensAt ? { opensAt: new Date(`${opensAt}T00:00:00`).toISOString() } : {}),
        ...(closesAt ? { closesAt: new Date(`${closesAt}T23:59:59`).toISOString() } : {}),
      };
      // A retry after a failed publish (or a second save) updates the existing
      // draft with the current form values; it never creates a second draft.
      const survey = createdId.current
        ? await update.mutateAsync({ id: createdId.current, ...body })
        : await create.mutateAsync(body);
      createdId.current = survey.id;
      if (andPublish) await publish.mutateAsync(survey.id);
      toast.success(t(andPublish ? 'surveys.form.published' : 'surveys.form.saved'));
      onDone();
    } catch (e) {
      // ponytail: matches server message text (surveys.service.ts:96,103); switch to an error
      // code when the API sends one. Never render the raw message (it carries UUIDs).
      const msg = e instanceof ApiError ? (e.message ?? '') : '';
      if (msg.startsWith('Duplicate survey target')) {
        setTargetsServerError(t('surveys.form.errorDuplicateTarget'));
      } else if (/is not assigned to subject/.test(msg)) {
        setTargetsServerError(t('surveys.form.errorNotAssigned'));
      } else {
        toast.error(t('surveys.form.errorMessage'));
      }
    }
  }

  const busy = create.isPending || update.isPending || publish.isPending;
  const errorCount =
    Object.keys(errors).length + Object.keys(rowErrors).length + Object.keys(questionErrors).length;
  const n = (value: number) => formatNumber(value, regionConfig);

  return (
    <FullPageShell
      title={t('surveys.form.title')}
      onClose={onDone}
      dirty={dirty}
      size="form"
      secondary={{ label: t('surveys.form.saveDraft'), onClick: () => void submit(false) }}
      primary={{
        label: t('surveys.form.publishNow'),
        onClick: () => void submit(true),
        busy,
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Ctrl+Enter bubbles from the focused field; the form itself is not the target */}
      <form
        noValidate
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.currentTarget.requestSubmit();
          }
        }}
      >
        <section className={CARD}>
          <h2 className="text-h2">{t('surveys.form.sectionInfo')}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="grid min-w-0 gap-1.5 md:col-span-2">
              <Label htmlFor="survey-title">
                <Req>{t('surveys.form.titleLabel')}</Req>
              </Label>
              <Input
                id="survey-title"
                value={title}
                aria-invalid={errors.title ? true : undefined}
                aria-describedby={errors.title ? 'survey-title-error' : undefined}
                className={errors.title ? INVALID : undefined}
                onChange={(e) => setTitle(e.target.value)}
              />
              <FieldError id="survey-title-error">{errors.title}</FieldError>
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="survey-respondent">{t('surveys.form.respondentLabel')}</Label>
              <Select
                value={respondent}
                onValueChange={(v) => setRespondent(v as SurveyRespondent)}
              >
                <SelectTrigger id="survey-respondent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESPONDENTS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {t(`surveys.respondents.${v}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <label className="flex min-h-11 items-center gap-3 font-medium md:min-h-8">
                <Checkbox
                  checked={anonymous}
                  onCheckedChange={(c) => setAnonymous(c === true)}
                  aria-describedby="survey-anonymous-hint"
                />
                {t('surveys.form.anonymousLabel')}
              </label>
              <p id="survey-anonymous-hint" className="text-caption text-text-secondary">
                {t(anonymous ? 'surveys.form.anonymousHintOn' : 'surveys.form.anonymousHintOff')}
              </p>
            </div>
          </div>
        </section>

        <section className={CARD} aria-labelledby="survey-targets-title">
          <h2 id="survey-targets-title" className="text-h2">
            <Req>{t('surveys.form.targetsLabel')}</Req>
          </h2>
          <p className={HELP}>{t('surveys.form.targetsHelp')}</p>
          <ul className="mt-4 divide-y divide-border-subtle">
            {targets.map((row, i) => {
              const rowError = rowErrors[row.key];
              return (
                <li key={row.key} className="py-4 first:pt-0">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start">
                    <div className="grid min-w-0 flex-1 gap-1.5">
                      <Label htmlFor={`survey-teacher-${row.key}`}>
                        {t('surveys.form.teacherN', { n: n(i + 1) })}
                      </Label>
                      <Combobox
                        id={`survey-teacher-${row.key}`}
                        aria-label={`${t('surveys.form.teacherLabel')} ${i + 1}`}
                        options={teacherOptions}
                        value={row.teacherId}
                        onValueChange={(v) => patchTarget(row.key, { teacherId: v })}
                        placeholder={t('surveys.form.teacherLabel')}
                      />
                    </div>
                    <div className="grid min-w-0 flex-1 gap-1.5">
                      <Label htmlFor={`survey-subject-${row.key}`}>
                        {t('surveys.form.subjectN', { n: n(i + 1) })}
                      </Label>
                      <Combobox
                        id={`survey-subject-${row.key}`}
                        aria-label={`${t('surveys.form.subjectLabel')} ${i + 1}`}
                        options={subjectOptions}
                        value={row.subjectId}
                        onValueChange={(v) => patchTarget(row.key, { subjectId: v })}
                        placeholder={t('surveys.form.subjectLabel')}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11 self-start px-4 text-destructive md:mt-6 md:size-8 md:px-0"
                      aria-label={t('surveys.form.removeTargetN', { n: i + 1 })}
                      title={t('surveys.form.removeTarget')}
                      disabled={targets.length === 1}
                      onClick={() => setTargets((rows) => rows.filter((r) => r.key !== row.key))}
                    >
                      <CircleMinusIcon aria-hidden="true" />
                      <span className="md:sr-only">{t('surveys.form.removeTarget')}</span>
                    </Button>
                  </div>
                  <FieldError id={`survey-row-error-${row.key}`}>{rowError}</FieldError>
                </li>
              );
            })}
          </ul>
          <FieldError id="survey-targets-error">{errors.targets ?? targetsServerError}</FieldError>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() =>
              setTargets((rows) => [...rows, { key: newKey(), teacherId: null, subjectId: null }])
            }
          >
            <PlusIcon aria-hidden="true" />
            {t('surveys.form.addTarget')}
          </Button>
        </section>

        <section className={CARD} aria-labelledby="survey-questions-title">
          <h2 id="survey-questions-title" className="text-h2">
            <Req>{t('surveys.form.questionsLabel')}</Req>
          </h2>
          <p className={HELP}>{t('surveys.form.questionsHelp')}</p>
          <ul className="mt-4 divide-y divide-border-subtle">
            {questions.map((q, i) => (
              <li key={q.key} className="flex flex-col gap-2 py-4 first:pt-0">
                <Label htmlFor={`survey-q-${q.key}`}>
                  {t('surveys.form.questionLabel', { n: i + 1 })}
                </Label>
                <Input
                  id={`survey-q-${q.key}`}
                  value={q.text}
                  aria-invalid={questionErrors[q.key] ? true : undefined}
                  className={questionErrors[q.key] ? INVALID : undefined}
                  onChange={(e) => patchQuestion(q.key, { text: e.target.value })}
                />
                <FieldError id={`survey-q-error-${q.key}`}>{questionErrors[q.key]}</FieldError>
                <div className="flex items-center justify-between gap-2">
                  <label className="flex min-h-11 items-center gap-3 md:min-h-8">
                    <Checkbox
                      checked={q.stars}
                      onCheckedChange={(c) => patchQuestion(q.key, { stars: c === true })}
                    />
                    {t('surveys.form.starsLabel')}
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    className="size-11 text-destructive md:size-8"
                    aria-label={t('surveys.form.removeQuestionN', { n: i + 1 })}
                    title={t('surveys.form.removeQuestion')}
                    onClick={() => setQuestions((rows) => rows.filter((r) => r.key !== q.key))}
                  >
                    <CircleMinusIcon aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <FieldError id="survey-questions-error">{errors.questions}</FieldError>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() =>
              setQuestions((rows) => [...rows, { key: newKey(), text: '', stars: true }])
            }
          >
            <PlusIcon aria-hidden="true" />
            {t('surveys.form.addQuestion')}
          </Button>
        </section>

        <section className={CARD}>
          <h2 className="text-h2">{t('surveys.form.sectionSchedule')}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="survey-opens">{t('surveys.form.opensAtLabel')}</Label>
              <DatePicker
                id="survey-opens"
                config={regionConfig}
                aria-label={t('surveys.form.opensAtLabel')}
                value={opensAt ? parseDate(opensAt) : undefined}
                onValueChange={(d) => setOpensAt(d ? toIsoDate(d) : '')}
              />
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="survey-closes">{t('surveys.form.closesAtLabel')}</Label>
              <DatePicker
                id="survey-closes"
                config={regionConfig}
                aria-label={t('surveys.form.closesAtLabel')}
                value={closesAt ? parseDate(closesAt) : undefined}
                min={opensAt ? parseDate(opensAt) : undefined}
                onValueChange={(d) => setClosesAt(d ? toIsoDate(d) : '')}
              />
              <FieldError id="survey-dates-error">{errors.dates}</FieldError>
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="survey-min">
                <Req>{t('surveys.form.minResponsesLabel')}</Req>
              </Label>
              <Input
                id="survey-min"
                type="number"
                min={MIN_RESPONSES}
                inputMode="numeric"
                value={minResponses}
                aria-invalid={errors.min ? true : undefined}
                className={errors.min ? INVALID : undefined}
                onChange={(e) => setMinResponses(e.target.value)}
                aria-describedby={errors.min ? 'survey-min-error' : 'survey-min-hint'}
              />
              <p id="survey-min-hint" className="text-caption text-text-secondary">
                {t('surveys.form.minResponsesHint')}
              </p>
              <FieldError id="survey-min-error">{errors.min}</FieldError>
            </div>
          </div>
        </section>

        {errorCount > 0 && (
          <p role="alert" className="sr-only">
            {t('surveys.form.errorSummary', { count: errorCount })}
          </p>
        )}
      </form>
    </FullPageShell>
  );
}
