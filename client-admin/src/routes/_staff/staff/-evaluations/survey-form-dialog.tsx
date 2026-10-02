/**
 * [28.4.2] The one "New teacher survey" form. Rendered from the Surveys tab
 * and from the evaluations page when the palette opens it via
 * `?publishSurvey=1`. Defaults make the common case short: three template
 * questions with stars on, anonymous, students and guardians, minimum 3.
 * Validation is on submit; errors are announced via `role="alert"`.
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
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
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

const RESPONDENTS: SurveyRespondent[] = ['BOTH', 'STUDENTS', 'GUARDIANS'];
const MIN_RESPONSES = 3;
const TEMPLATE_KEYS = ['clear', 'respect', 'help'] as const;

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

export interface SurveyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SurveyFormDialog({ open, onOpenChange }: SurveyFormDialogProps) {
  const { t } = useTranslation('evaluations');
  const create = useCreateSurvey();
  const publish = usePublishSurvey();
  const update = useUpdateSurvey();
  const teachers = useAllTeachers({ enabled: open });
  const subjects = useAllSubjects();
  const nextKey = React.useRef(0);
  const createdId = React.useRef<string | null>(null);
  const newKey = () => nextKey.current++;

  const [title, setTitle] = React.useState('');
  const [anonymous, setAnonymous] = React.useState(true);
  const [respondent, setRespondent] = React.useState<SurveyRespondent>('BOTH');
  const [targets, setTargets] = React.useState<TargetRow[]>([]);
  const [questions, setQuestions] = React.useState<QuestionRow[]>([]);
  const [opensAt, setOpensAt] = React.useState('');
  const [closesAt, setClosesAt] = React.useState('');
  const [minResponses, setMinResponses] = React.useState(String(MIN_RESPONSES));
  const [errors, setErrors] = React.useState<string[]>([]);
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    createdId.current = null;
    setTitle('');
    setAnonymous(true);
    setRespondent('BOTH');
    setTargets([{ key: newKey(), teacherId: null, subjectId: null }]);
    // Template set: the common case is "accept and go".
    setQuestions(
      TEMPLATE_KEYS.map((k) => ({
        key: newKey(),
        text: t(`surveys.form.templateQuestions.${k}`),
        stars: true,
      })),
    );
    setOpensAt('');
    setClosesAt('');
    setMinResponses(String(MIN_RESPONSES));
    setErrors([]);
    setServerError(null);
    create.reset();
    publish.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open]);

  const teacherOptions = (teachers.data ?? []).map((x) => ({
    value: x.id,
    label: `${x.user.full_name} (${x.employee_id})`,
  }));
  const subjectOptions = (subjects.data ?? []).map((x) => ({
    value: x.id,
    label: `${x.name_en} (${x.code})`,
  }));

  const patchTarget = (key: number, patch: Partial<TargetRow>) =>
    setTargets((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const patchQuestion = (key: number, patch: Partial<QuestionRow>) =>
    setQuestions((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function validate(): string[] {
    const next: string[] = [];
    if (!title.trim()) next.push(t('surveys.form.errorTitle'));
    if (targets.length === 0 || targets.some((r) => !r.teacherId || !r.subjectId)) {
      next.push(t('surveys.form.errorTargets'));
    }
    if (questions.length === 0) next.push(t('surveys.form.errorQuestions'));
    else if (questions.some((q) => !q.text.trim())) next.push(t('surveys.form.errorQuestionText'));
    if (!(Number(minResponses) >= MIN_RESPONSES)) next.push(t('surveys.form.errorMin'));
    if (opensAt && closesAt && closesAt <= opensAt) next.push(t('surveys.form.errorDates'));
    return next;
  }

  async function submit(andPublish: boolean) {
    const next = validate();
    setErrors(next);
    setServerError(null);
    if (next.length > 0) return;
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
      onOpenChange(false);
    } catch (e) {
      // The server names the exact problem (for example a teacher not assigned
      // to a subject); fall back to the generic line.
      setServerError(
        e instanceof ApiError && e.message ? e.message : t('surveys.form.errorMessage'),
      );
    }
  }

  const busy = create.isPending || update.isPending || publish.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('surveys.form.title')}</DialogTitle>
        </DialogHeader>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Ctrl+Enter bubbles from the focused field; the form itself is not the target */}
        <form
          noValidate
          className="flex flex-col gap-5"
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
          <div className="flex flex-col gap-1.5">
            <label htmlFor="survey-title" className="text-sm font-medium">
              {t('surveys.form.titleLabel')}
            </label>
            <Input id="survey-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium">{t('surveys.form.targetsLabel')}</legend>
            {targets.map((row, i) => (
              <div key={row.key} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Combobox
                    aria-label={`${t('surveys.form.teacherLabel')} ${i + 1}`}
                    options={teacherOptions}
                    value={row.teacherId}
                    onValueChange={(v) => patchTarget(row.key, { teacherId: v })}
                    placeholder={t('surveys.form.teacherLabel')}
                  />
                </div>
                <div className="flex-1">
                  <Combobox
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
                  disabled={targets.length === 1}
                  onClick={() => setTargets((rows) => rows.filter((r) => r.key !== row.key))}
                >
                  {t('surveys.form.removeTarget')}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() =>
                setTargets((rows) => [...rows, { key: newKey(), teacherId: null, subjectId: null }])
              }
            >
              {t('surveys.form.addTarget')}
            </Button>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium">{t('surveys.form.questionsLabel')}</legend>
            {questions.map((q, i) => (
              <div key={q.key} className="flex flex-col gap-2 rounded-md border p-3">
                <label htmlFor={`survey-q-${q.key}`} className="text-sm">
                  {t('surveys.form.questionLabel', { n: i + 1 })}
                </label>
                <Input
                  id={`survey-q-${q.key}`}
                  value={q.text}
                  onChange={(e) => patchQuestion(q.key, { text: e.target.value })}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={q.stars}
                      onCheckedChange={(c) => patchQuestion(q.key, { stars: c === true })}
                    />
                    {t('surveys.form.starsLabel')}
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setQuestions((rows) => rows.filter((r) => r.key !== q.key))}
                  >
                    {t('surveys.form.removeQuestion')}
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() =>
                setQuestions((rows) => [...rows, { key: newKey(), text: '', stars: true }])
              }
            >
              {t('surveys.form.addQuestion')}
            </Button>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={anonymous} onCheckedChange={(c) => setAnonymous(c === true)} />
              {t('surveys.form.anonymousLabel')}
            </label>
            <p className="text-sm text-muted-foreground">
              {t(anonymous ? 'surveys.form.anonymousHintOn' : 'surveys.form.anonymousHintOff')}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="survey-respondent" className="text-sm font-medium">
                {t('surveys.form.respondentLabel')}
              </label>
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
            <div className="flex flex-col gap-1.5">
              <label htmlFor="survey-min" className="text-sm font-medium">
                {t('surveys.form.minResponsesLabel')}
              </label>
              <Input
                id="survey-min"
                type="number"
                min={MIN_RESPONSES}
                inputMode="numeric"
                value={minResponses}
                onChange={(e) => setMinResponses(e.target.value)}
                aria-describedby="survey-min-hint"
              />
              <p id="survey-min-hint" className="text-sm text-muted-foreground">
                {t('surveys.form.minResponsesHint')}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="survey-opens" className="text-sm font-medium">
                {t('surveys.form.opensAtLabel')}
              </label>
              <Input
                id="survey-opens"
                type="date"
                value={opensAt}
                onChange={(e) => setOpensAt(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="survey-closes" className="text-sm font-medium">
                {t('surveys.form.closesAtLabel')}
              </label>
              <Input
                id="survey-closes"
                type="date"
                value={closesAt}
                onChange={(e) => setClosesAt(e.target.value)}
              />
            </div>
          </div>

          {errors.length > 0 && (
            <ul role="alert" className="list-disc ps-5 text-sm text-destructive">
              {errors.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          )}
          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" variant="outline" disabled={busy}>
              {busy ? t('surveys.form.saving') : t('surveys.form.saveDraft')}
            </Button>
            <Button type="button" loading={busy} onClick={() => void submit(true)}>
              {t('surveys.form.publishNow')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
