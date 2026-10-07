/**
 * [35.4.5] Exam-structure part grid, redesigned in [31.4.exams-3b]: one tab per
 * class grade (selected grade in the URL), one Card per subject, one row per
 * part `name · type · full · pass`. Editing model cloned from
 * `grading-scales/-band-editor.tsx`: Tab walks cells in DOM order, Enter in a
 * block's last cell appends a row (focus lands on its name), and Esc inside a
 * text field just leaves it (Discard is a header control). The draft lives here and spans every
 * class; the page header owns Save / Discard through the `ref` handle, and
 * Save sends the WHOLE row set (the server replaces all rows).
 *
 * Client validation mirrors `ExamTemplateRowInputDto` + `validateRows` so a
 * valid grid can never 400: name 1..200 chars and unique per (grade,
 * subject), `0 < full <= 9999.99`, `0 <= pass <= full`, 2 decimals, grade
 * 1..99, subject code <= 20 chars, at least one part per subject block.
 * Marks accept Bangla or Latin digits and show in the tenant's digits.
 */
import { ExamComponentKind } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, renderDigits, toLatinDigits } from '@biddaloy/ui/utils';
import { CircleAlert, CircleMinus, FileStack, Plus } from 'lucide-react';
import * as React from 'react';

import type { ExamTemplateDetail, ExamTemplateRowInput } from './-use-exam-templates';

type ComponentKind = ExamTemplateRowInput['components'][number]['kind'];

export const MAX_MARKS = 9999.99;
export const NAME_MAX = 200;
export const SUBJECT_CODE_MAX = 20;
const COMPONENT_KINDS = Object.values(ExamComponentKind);
const MARKS_RE = /^\d+(\.\d{1,2})?$/;

const CARD = 'rounded-lg border border-border-subtle bg-surface shadow-e1';
const REMOVE =
  'inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-label font-medium text-destructive hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring';

export interface GridSubject {
  code: string;
  /** English name — kept for the stable accessible names (`cellLabel`). */
  name: string;
  /** Name in the UI language, shown on screen. */
  label: string;
}

export interface TemplateGridHandle {
  save: () => void;
  discard: () => void;
}

export interface TemplateGridProps {
  ref?: React.Ref<TemplateGridHandle>;
  rows: ExamTemplateDetail['rows'];
  /** The tenant's subjects — the picker offers these. */
  subjects: GridSubject[];
  selectedGrade?: number | undefined;
  onGradeChange?: (grade: number) => void;
  onStateChange?: (state: { dirty: boolean }) => void;
  onSave: (rows: ExamTemplateRowInput[]) => void;
}

interface DraftComponent {
  key: string;
  name: string;
  kind: ComponentKind;
  full: string;
  pass: string;
}
interface DraftBlock {
  key: string;
  classGrade: number;
  subjectCode: string;
  components: DraftComponent[];
}

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

function toDraft(
  rows: TemplateGridProps['rows'],
  numerals: Parameters<typeof renderDigits>[1],
): DraftBlock[] {
  return rows.map((r) => ({
    key: nextKey(),
    classGrade: r.classGrade,
    subjectCode: r.subjectCode,
    components: r.components.map((c) => ({
      key: nextKey(),
      name: c.name,
      kind: c.kind,
      full: renderDigits(String(c.full), numerals),
      pass: renderDigits(String(c.pass), numerals),
    })),
  }));
}

const plain = (bs: DraftBlock[]) =>
  bs.map((b) => [
    b.classGrade,
    b.subjectCode,
    b.components.map((c) => [c.name, c.kind, c.full, c.pass]),
  ]);

type ErrorCode =
  | 'nameRequired'
  | 'nameTooLong'
  | 'nameDuplicate'
  | 'fullInvalid'
  | 'passInvalid'
  | 'attendanceDuplicate';

/** Per-component error codes; empty object = valid. Exported for the tests. */
export function validateBlock(block: DraftBlock): Record<string, ErrorCode> {
  const errors: Record<string, ErrorCode> = {};
  const seen = new Set<string>();
  let attendanceSeen = false;
  for (const c of block.components) {
    const name = c.name.trim();
    const fullText = toLatinDigits(c.full).trim();
    const passText = toLatinDigits(c.pass).trim();
    const full = Number(fullText);
    const fullOk = MARKS_RE.test(fullText) && full > 0 && full <= MAX_MARKS;
    const pass = Number(passText);
    const passOk =
      MARKS_RE.test(passText) && pass >= 0 && pass <= MAX_MARKS && (!fullOk || pass <= full);
    if (!name) errors[c.key] = 'nameRequired';
    else if (name.length > NAME_MAX) errors[c.key] = 'nameTooLong';
    else if (seen.has(name)) errors[c.key] = 'nameDuplicate';
    else if (!fullOk) errors[c.key] = 'fullInvalid';
    else if (!passOk) errors[c.key] = 'passInvalid';
    else if (c.kind === ExamComponentKind.ATTENDANCE && attendanceSeen)
      errors[c.key] = 'attendanceDuplicate';
    if (c.kind === ExamComponentKind.ATTENDANCE) attendanceSeen = true;
    seen.add(name);
  }
  return errors;
}

export function TemplateGrid({
  ref,
  rows,
  subjects,
  selectedGrade,
  onGradeChange,
  onStateChange,
  onSave,
}: TemplateGridProps) {
  const { t } = useTranslation('examTemplates');
  const config = useRegionConfig();
  const numerals = config.numerals;
  const [blocks, setBlocks] = React.useState(() => toDraft(rows, numerals));
  const [extraGrades, setExtraGrades] = React.useState<number[]>([]);
  // Fallback selection when the parent does not control `selectedGrade`.
  const [localGrade, setLocalGrade] = React.useState<number | undefined>(undefined);
  function selectGrade(grade: number) {
    setLocalGrade(grade);
    onGradeChange?.(grade);
  }
  const [gradeOpen, setGradeOpen] = React.useState(false);
  const [gradeInput, setGradeInput] = React.useState('');
  const [gradeError, setGradeError] = React.useState(false);
  const [pickers, setPickers] = React.useState<Record<number, string>>({});
  const [attempted, setAttempted] = React.useState(false);
  const focusKey = React.useRef<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Re-seed when the saved CONTENT changes (after a save / refetch) — keyed on
  // content, not identity, so a rename's refetch does not wipe grid edits.
  const savedSig = JSON.stringify(rows);
  React.useEffect(() => {
    setBlocks(toDraft(rows, numerals));
    setExtraGrades([]);
    setAttempted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- savedSig is the content key for rows
  }, [savedSig]);

  React.useEffect(() => {
    if (!focusKey.current) return;
    rootRef.current?.querySelector<HTMLElement>(`[data-key="${focusKey.current}"]`)?.focus();
    focusKey.current = null;
  });

  const subjectOf = (code: string) => subjects.find((s) => s.code === code);
  const subjectEnglish = (code: string) =>
    subjectOf(code)?.name ?? rows.find((r) => r.subjectCode === code)?.subjectName ?? null;
  const subjectShown = (code: string) =>
    subjectOf(code)?.label ?? rows.find((r) => r.subjectCode === code)?.subjectName ?? code;

  function patchBlock(key: string, fn: (b: DraftBlock) => DraftBlock) {
    setBlocks(blocks.map((b) => (b.key === key ? fn(b) : b)));
  }
  function patchComponent(block: DraftBlock, key: string, patch: Partial<DraftComponent>) {
    patchBlock(block.key, (b) => ({
      ...b,
      components: b.components.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    }));
  }
  function addComponent(block: DraftBlock) {
    const key = nextKey();
    focusKey.current = `${key}-name`;
    patchBlock(block.key, (b) => ({
      ...b,
      components: [
        ...b.components,
        { key, name: '', kind: ExamComponentKind.WRITTEN, full: '', pass: '' },
      ],
    }));
  }
  function addSubject(grade: number) {
    const code = pickers[grade];
    if (!code) return;
    const key = nextKey();
    const componentKey = nextKey();
    focusKey.current = `${componentKey}-name`;
    setBlocks([
      ...blocks,
      {
        key,
        classGrade: grade,
        subjectCode: code,
        components: [
          { key: componentKey, name: '', kind: ExamComponentKind.WRITTEN, full: '', pass: '' },
        ],
      },
    ]);
    setPickers({ ...pickers, [grade]: '' });
  }
  function addGrade(event: React.FormEvent) {
    event.preventDefault();
    const n = Number(toLatinDigits(gradeInput).trim());
    if (!Number.isInteger(n) || n < 1 || n > 99) {
      setGradeError(true);
      return;
    }
    setGradeError(false);
    setGradeInput('');
    setGradeOpen(false);
    if (!grades.includes(n)) setExtraGrades([...extraGrades, n]);
    selectGrade(n);
  }
  function discard() {
    setBlocks(toDraft(rows, numerals));
    setExtraGrades([]);
    setAttempted(false);
  }

  const dirty = JSON.stringify(plain(blocks)) !== JSON.stringify(plain(toDraft(rows, numerals)));
  const grades = [...new Set([...blocks.map((b) => b.classGrade), ...extraGrades])].sort(
    (a, b) => a - b,
  );
  const requested = selectedGrade ?? localGrade;
  const active = requested !== undefined && grades.includes(requested) ? requested : grades[0];
  const allErrors = blocks.map(validateBlock);
  const blockInvalid = (b: DraftBlock, i: number) =>
    Object.keys(allErrors[i] ?? {}).length > 0 ||
    b.components.length === 0 ||
    b.subjectCode.length > SUBJECT_CODE_MAX;
  const invalid = blocks.some(blockInvalid);

  function save() {
    setAttempted(true);
    if (invalid) return;
    onSave(
      blocks.map((b) => ({
        classGrade: b.classGrade,
        subjectCode: b.subjectCode,
        components: b.components.map((c) => ({
          name: c.name.trim(),
          kind: c.kind,
          full: Number(toLatinDigits(c.full).trim()),
          pass: Number(toLatinDigits(c.pass).trim()),
        })),
      })),
    );
  }

  React.useImperativeHandle(ref, () => ({ save, discard }));
  React.useEffect(() => onStateChange?.({ dirty }), [dirty]); // eslint-disable-line react-hooks/exhaustive-deps -- notify on change only

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Only plain text fields in the grid itself (not the add-class dialog,
    // which is portalled): an open Select handles its own Esc.
    // Esc never throws the whole draft away silently: Discard (header) does that, with a
    // visible control. Esc just leaves the field.
    if (
      event.key === 'Escape' &&
      event.target instanceof HTMLInputElement &&
      rootRef.current?.contains(event.target)
    ) {
      event.target.blur();
    }
  }

  const gradeDialog = (
    <Dialog open={gradeOpen} onOpenChange={setGradeOpen}>
      <DialogContent size="sm">
        <form onSubmit={addGrade} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('grid.addGradeTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-grid-grade">{t('grid.gradeLabel')}</Label>
            <Input
              id="template-grid-grade"
              inputMode="numeric"
              aria-invalid={gradeError}
              value={gradeInput}
              onChange={(e) => setGradeInput(e.target.value)}
            />
            <p className="text-sm text-text-secondary">{t('grid.gradeHelp')}</p>
            {gradeError && (
              <p role="alert" className="text-sm text-destructive">
                {t('grid.error.gradeInvalid')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setGradeOpen(false)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit">{t('grid.addGrade')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  if (active === undefined) {
    return (
      <>
        <EmptyState
          icon={<FileStack aria-hidden className="size-6" />}
          title={t('detail.noGradesTitle')}
          explanation={t('detail.noGradesText')}
          action={{ label: t('grid.addGrade'), onClick: () => setGradeOpen(true) }}
        />
        {gradeDialog}
      </>
    );
  }

  const gradeBlocks = blocks.filter((b) => b.classGrade === active);
  const free = subjects.filter((s) => !gradeBlocks.some((b) => b.subjectCode === s.code));
  const errorGrades = new Set(
    attempted ? blocks.filter(blockInvalid).map((b) => b.classGrade) : [],
  );

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- delegates Esc from inner inputs
    <div ref={rootRef} className="flex flex-col gap-6" onKeyDown={onKeyDown}>
      <Tabs value={String(active)} onValueChange={(v) => selectGrade(Number(v))}>
        <div className="flex items-center overflow-x-auto">
          <TabsList variant="line" aria-label={t('grid.gradesLabel')}>
            {grades.map((grade) => (
              <TabsTrigger key={grade} value={String(grade)} className="min-h-11 md:min-h-0">
                {t('grid.gradeHeading', { grade: formatNumber(grade, config) })}
                {errorGrades.has(grade) && (
                  <CircleAlert
                    className="size-4 text-destructive"
                    aria-label={t('grid.gradeHasErrors', { grade: formatNumber(grade, config) })}
                  />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          <button
            type="button"
            onClick={() => setGradeOpen(true)}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 px-3 font-medium text-primary hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:h-10"
          >
            <Plus aria-hidden className="size-4" />
            {t('grid.addGrade')}
          </button>
        </div>

        <TabsContent value={String(active)} className="mt-4 flex flex-col gap-6">
          <p className="text-text-secondary">
            {t('grid.intro', {
              n: formatNumber(gradeBlocks.length, config),
              grade: formatNumber(active, config),
            })}
          </p>

          {attempted && invalid && (
            <p role="alert" className="text-sm text-destructive">
              {t('grid.error.fixErrors')}
            </p>
          )}

          {gradeBlocks.map((block) => {
            const errors = allErrors[blocks.indexOf(block)] ?? {};
            const english = subjectEnglish(block.subjectCode);
            // Stable accessible names (e2e): code + English name, whatever the UI language.
            const heading = english ? `${block.subjectCode} — ${english}` : block.subjectCode;
            const total = block.components.reduce((sum, c) => {
              const n = Number(toLatinDigits(c.full).trim());
              return MARKS_RE.test(toLatinDigits(c.full).trim()) ? sum + n : sum;
            }, 0);
            return (
              <section key={block.key} className={`${CARD} overflow-hidden`}>
                <div className="flex items-start justify-between gap-3 p-4 md:px-5 md:pt-5 md:pb-4">
                  <div className="min-w-0">
                    <h3 className="text-h3">{subjectShown(block.subjectCode)}</h3>
                    <p className="text-caption text-text-secondary">
                      {t('grid.subjectCaption', {
                        code: block.subjectCode,
                        n: formatNumber(block.components.length, config),
                        marks: formatNumber(total, config),
                      })}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`${REMOVE} md:h-8`}
                    aria-label={t('grid.removeSubject', { subject: heading, grade: active })}
                    onClick={() => setBlocks(blocks.filter((b) => b.key !== block.key))}
                  >
                    <CircleMinus aria-hidden className="size-4" />
                    {t('grid.removeSubjectShort')}
                  </button>
                </div>

                <div
                  aria-hidden="true"
                  className="hidden h-10 grid-cols-12 items-center gap-4 border-y border-border-subtle bg-muted px-4 text-label text-text-secondary md:grid"
                >
                  <span className="col-span-4">{t('grid.columnName')}</span>
                  <span className="col-span-3">{t('grid.columnKind')}</span>
                  <span className="col-span-2 text-right">{t('grid.columnFull')}</span>
                  <span className="col-span-2 text-right">{t('grid.columnPass')}</span>
                  <span className="col-span-1 text-right">{t('grid.columnActions')}</span>
                </div>

                <div className="divide-y divide-border-subtle border-t border-border-subtle px-4 md:border-t-0 md:px-0">
                  {block.components.map((c, index) => {
                    const code = attempted ? errors[c.key] : undefined;
                    const label = (col: string) =>
                      t('grid.cellLabel', {
                        column: t(col),
                        subject: heading,
                        grade: active,
                        row: index + 1,
                      });
                    const isLast = index === block.components.length - 1;
                    return (
                      <div
                        key={c.key}
                        className="grid grid-cols-2 gap-3 py-3 md:grid-cols-12 md:items-start md:gap-4 md:px-4 md:py-2"
                      >
                        <div className="col-span-2 flex flex-col gap-1.5 md:col-span-4">
                          <Label htmlFor={`${c.key}-name`} className="text-label md:sr-only">
                            {t('grid.columnName')}
                          </Label>
                          <Input
                            id={`${c.key}-name`}
                            data-key={`${c.key}-name`}
                            aria-label={label('grid.columnName')}
                            aria-invalid={
                              code === 'nameRequired' ||
                              code === 'nameTooLong' ||
                              code === 'nameDuplicate'
                            }
                            value={c.name}
                            onChange={(e) => patchComponent(block, c.key, { name: e.target.value })}
                          />
                          {code && code.startsWith('name') && (
                            <p role="alert" className="text-sm text-destructive">
                              {t(`grid.error.${code}`, { max: formatNumber(NAME_MAX, config) })}
                            </p>
                          )}
                        </div>
                        <div className="col-span-2 flex flex-col gap-1.5 md:col-span-3">
                          <Label htmlFor={`${c.key}-kind`} className="text-label md:sr-only">
                            {t('grid.columnKind')}
                          </Label>
                          <Select
                            value={c.kind}
                            onValueChange={(v) =>
                              patchComponent(block, c.key, { kind: v as ComponentKind })
                            }
                          >
                            <SelectTrigger
                              id={`${c.key}-kind`}
                              className="w-full"
                              aria-label={label('grid.columnKind')}
                              aria-invalid={code === 'attendanceDuplicate'}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {COMPONENT_KINDS.map((k) => (
                                <SelectItem key={k} value={k}>
                                  {t(`componentKind.${k}`, { ns: 'exams' })}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {code === 'attendanceDuplicate' && (
                            <p role="alert" className="text-sm text-destructive">
                              {t('grid.error.attendanceDuplicate')}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5 md:col-span-2">
                          <Label htmlFor={`${c.key}-full`} className="text-label md:sr-only">
                            {t('grid.columnFull')}
                          </Label>
                          <Input
                            id={`${c.key}-full`}
                            inputMode="decimal"
                            className="text-right tabular-nums"
                            aria-label={label('grid.columnFull')}
                            aria-invalid={code === 'fullInvalid'}
                            value={c.full}
                            onChange={(e) => patchComponent(block, c.key, { full: e.target.value })}
                          />
                          {code === 'fullInvalid' && (
                            <p role="alert" className="text-sm text-destructive">
                              {t('grid.error.fullInvalid', {
                                max: formatNumber(MAX_MARKS, config, { decimals: 2 }),
                              })}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5 md:col-span-2">
                          <Label htmlFor={`${c.key}-pass`} className="text-label md:sr-only">
                            {t('grid.columnPass')}
                          </Label>
                          <Input
                            id={`${c.key}-pass`}
                            inputMode="decimal"
                            className="text-right tabular-nums"
                            aria-label={label('grid.columnPass')}
                            aria-invalid={code === 'passInvalid'}
                            value={c.pass}
                            onChange={(e) => patchComponent(block, c.key, { pass: e.target.value })}
                            onKeyDown={(e) => {
                              // Enter in the block's last cell appends a row.
                              if (e.key === 'Enter' && isLast) {
                                e.preventDefault();
                                addComponent(block);
                              }
                            }}
                          />
                          {code === 'passInvalid' && (
                            <p role="alert" className="text-sm text-destructive">
                              {t('grid.error.passInvalid')}
                            </p>
                          )}
                        </div>
                        <div className="col-span-2 flex justify-end md:col-span-1">
                          <button
                            type="button"
                            className={`${REMOVE} md:size-8 md:px-0`}
                            aria-label={t('grid.removeRow', {
                              subject: heading,
                              grade: active,
                              row: index + 1,
                            })}
                            onClick={() =>
                              patchBlock(block.key, (b) => ({
                                ...b,
                                components: b.components.filter((x) => x.key !== c.key),
                              }))
                            }
                          >
                            <CircleMinus aria-hidden className="size-4" />
                            <span className="md:sr-only">{t('grid.removeRowShort')}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {attempted && block.components.length === 0 && (
                  <p role="alert" className="px-4 pb-2 text-sm text-destructive md:px-5">
                    {t('grid.error.noComponents')}
                  </p>
                )}
                <div className="border-t border-border-subtle px-2 py-1 md:px-3">
                  <button
                    type="button"
                    onClick={() => addComponent(block)}
                    className="inline-flex h-11 items-center gap-1.5 rounded-md px-3 font-medium text-primary hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:h-9"
                  >
                    <Plus aria-hidden className="size-4" />
                    {t('grid.addComponent')}
                  </button>
                </div>
              </section>
            );
          })}

          <section className={`${CARD} p-4 md:p-5`}>
            <h2 className="text-h2">
              {t('grid.addSubjectTitle', { grade: formatNumber(active, config) })}
            </h2>
            <div className="mt-4 grid gap-4 md:grid-cols-12 md:items-end">
              <div className="flex flex-col gap-1.5 md:col-span-5">
                <Label htmlFor="template-grid-subject">{t('grid.subjectLabel')}</Label>
                <Select
                  value={pickers[active] ?? ''}
                  onValueChange={(v) => setPickers({ ...pickers, [active]: v })}
                >
                  <SelectTrigger
                    id="template-grid-subject"
                    className="w-full"
                    aria-label={t('grid.subjectPicker', { grade: active })}
                  >
                    <SelectValue placeholder={t('grid.subjectPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {free.map((s) => (
                      <SelectItem key={s.code} value={s.code}>
                        {s.code} — {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full md:w-auto"
                disabled={!pickers[active]}
                onClick={() => addSubject(active)}
              >
                {t('grid.addSubject')}
              </Button>
            </div>
          </section>
        </TabsContent>
      </Tabs>
      {gradeDialog}
    </div>
  );
}
