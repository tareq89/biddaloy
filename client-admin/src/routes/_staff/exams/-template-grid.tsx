/**
 * [35.4.5] Exam-template component grid: one section per class grade, one
 * table per subject, rows `name · kind · full · pass`. Editing model cloned
 * from `grading-scales/-band-editor.tsx`: Tab walks cells in DOM order,
 * Enter in a block's last cell appends a row (focus lands on its name), and
 * Esc inside a text field discards unsaved edits. The draft lives here; Save
 * sends the WHOLE row set (the server replaces all rows).
 *
 * Client validation mirrors `ExamTemplateRowInputDto` + `validateRows` so a
 * valid grid can never 400: name 1..200 chars and unique per (grade,
 * subject), `0 < full <= 9999.99`, `0 <= pass <= full`, 2 decimals, grade
 * 1..99, subject code <= 20 chars, at least one component per subject block.
 */
import { ExamComponentKind } from '@biddaloy/shared';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import type { ExamTemplateDetail, ExamTemplateRowInput } from './use-exam-templates';

type ComponentKind = ExamTemplateRowInput['components'][number]['kind'];

export const MAX_MARKS = 9999.99;
export const NAME_MAX = 200;
export const SUBJECT_CODE_MAX = 20;
const COMPONENT_KINDS = Object.values(ExamComponentKind);
const MARKS_RE = /^\d+(\.\d{1,2})?$/;

export interface GridSubject {
  code: string;
  name: string;
}

export interface TemplateGridProps {
  rows: ExamTemplateDetail['rows'];
  /** The tenant's subjects — the picker offers these (code + name). */
  subjects: GridSubject[];
  onSave: (rows: ExamTemplateRowInput[]) => void;
  saving?: boolean;
  /** Server message from the last failed save. */
  error?: string | null;
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

function toDraft(rows: TemplateGridProps['rows']): DraftBlock[] {
  return rows.map((r) => ({
    key: nextKey(),
    classGrade: r.classGrade,
    subjectCode: r.subjectCode,
    components: r.components.map((c) => ({
      key: nextKey(),
      name: c.name,
      kind: c.kind,
      full: String(c.full),
      pass: String(c.pass),
    })),
  }));
}

const plain = (bs: DraftBlock[]) =>
  bs.map((b) => [
    b.classGrade,
    b.subjectCode,
    b.components.map((c) => [c.name, c.kind, c.full, c.pass]),
  ]);

type ErrorCode = 'nameRequired' | 'nameTooLong' | 'nameDuplicate' | 'fullInvalid' | 'passInvalid';

/** Per-component error codes; empty object = valid. Exported for the tests. */
export function validateBlock(block: DraftBlock): Record<string, ErrorCode> {
  const errors: Record<string, ErrorCode> = {};
  const seen = new Set<string>();
  for (const c of block.components) {
    const name = c.name.trim();
    const full = Number(c.full);
    const fullOk = MARKS_RE.test(c.full.trim()) && full > 0 && full <= MAX_MARKS;
    const pass = Number(c.pass);
    const passOk =
      MARKS_RE.test(c.pass.trim()) && pass >= 0 && pass <= MAX_MARKS && (!fullOk || pass <= full);
    if (!name) errors[c.key] = 'nameRequired';
    else if (name.length > NAME_MAX) errors[c.key] = 'nameTooLong';
    else if (seen.has(name)) errors[c.key] = 'nameDuplicate';
    else if (!fullOk) errors[c.key] = 'fullInvalid';
    else if (!passOk) errors[c.key] = 'passInvalid';
    seen.add(name);
  }
  return errors;
}

export function TemplateGrid({ rows, subjects, onSave, saving, error }: TemplateGridProps) {
  const { t } = useTranslation('examTemplates');
  const [blocks, setBlocks] = React.useState(() => toDraft(rows));
  const [extraGrades, setExtraGrades] = React.useState<number[]>([]);
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
    setBlocks(toDraft(rows));
    setExtraGrades([]);
    setAttempted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- savedSig is the content key for rows
  }, [savedSig]);

  React.useEffect(() => {
    if (!focusKey.current) return;
    rootRef.current?.querySelector<HTMLElement>(`[data-key="${focusKey.current}"]`)?.focus();
    focusKey.current = null;
  });

  const subjectName = (code: string) =>
    subjects.find((s) => s.code === code)?.name ??
    rows.find((r) => r.subjectCode === code)?.subjectName ??
    null;

  function change(next: DraftBlock[]) {
    setBlocks(next);
  }
  function patchBlock(key: string, fn: (b: DraftBlock) => DraftBlock) {
    change(blocks.map((b) => (b.key === key ? fn(b) : b)));
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
    change([
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
  function addGrade() {
    const n = Number(gradeInput);
    if (!Number.isInteger(n) || n < 1 || n > 99) {
      setGradeError(true);
      return;
    }
    setGradeError(false);
    setGradeInput('');
    if (!grades.includes(n)) setExtraGrades([...extraGrades, n]);
  }
  function discard() {
    setBlocks(toDraft(rows));
    setExtraGrades([]);
    setAttempted(false);
  }

  const dirty = JSON.stringify(plain(blocks)) !== JSON.stringify(plain(toDraft(rows)));
  const grades = [...new Set([...blocks.map((b) => b.classGrade), ...extraGrades])].sort(
    (a, b) => a - b,
  );
  const allErrors = blocks.map(validateBlock);
  const invalid =
    allErrors.some((e) => Object.keys(e).length > 0) ||
    blocks.some((b) => b.components.length === 0 || b.subjectCode.length > SUBJECT_CODE_MAX);

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
          full: Number(c.full),
          pass: Number(c.pass),
        })),
      })),
    );
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Only plain text fields: an open Select handles its own Esc.
    if (event.key === 'Escape' && dirty && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      discard();
    }
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- delegates Esc from inner inputs
    <div ref={rootRef} className="flex flex-col gap-6" onKeyDown={onKeyDown}>
      {grades.length === 0 && <p className="text-sm text-muted-foreground">{t('grid.empty')}</p>}

      {grades.map((grade) => {
        const gradeBlocks = blocks.filter((b) => b.classGrade === grade);
        const free = subjects.filter((s) => !gradeBlocks.some((b) => b.subjectCode === s.code));
        return (
          <section key={grade} aria-labelledby={`grade-${grade}`} className="flex flex-col gap-4">
            <h2 id={`grade-${grade}`} className="text-base font-semibold">
              {t('grid.gradeHeading', { grade })}
            </h2>

            {gradeBlocks.map((block) => {
              const errors = allErrors[blocks.indexOf(block)] ?? {};
              const name = subjectName(block.subjectCode);
              const heading = name ? `${block.subjectCode} — ${name}` : block.subjectCode;
              return (
                <div key={block.key} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">{heading}</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={t('grid.removeSubject', { subject: heading, grade })}
                      onClick={() => change(blocks.filter((b) => b.key !== block.key))}
                    >
                      {t('grid.removeSubjectShort')}
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('grid.columnName')}</TableHead>
                        <TableHead>{t('grid.columnKind')}</TableHead>
                        <TableHead>{t('grid.columnFull')}</TableHead>
                        <TableHead>{t('grid.columnPass')}</TableHead>
                        <TableHead>{t('grid.columnActions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {block.components.map((c, index) => {
                        const code = attempted ? errors[c.key] : undefined;
                        const label = (col: string) =>
                          t('grid.cellLabel', {
                            column: t(col),
                            subject: heading,
                            grade,
                            row: index + 1,
                          });
                        const isLast = index === block.components.length - 1;
                        return (
                          <TableRow key={c.key}>
                            <TableCell>
                              <Input
                                data-key={`${c.key}-name`}
                                aria-label={label('grid.columnName')}
                                aria-invalid={
                                  code === 'nameRequired' ||
                                  code === 'nameTooLong' ||
                                  code === 'nameDuplicate'
                                }
                                value={c.name}
                                onChange={(e) =>
                                  patchComponent(block, c.key, { name: e.target.value })
                                }
                              />
                              {code && code.startsWith('name') && (
                                <p role="alert" className="mt-1 text-xs text-destructive">
                                  {t(`grid.error.${code}`, { max: NAME_MAX })}
                                </p>
                              )}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={c.kind}
                                onValueChange={(v) =>
                                  patchComponent(block, c.key, { kind: v as ComponentKind })
                                }
                              >
                                <SelectTrigger aria-label={label('grid.columnKind')}>
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
                            </TableCell>
                            <TableCell>
                              <Input
                                inputMode="decimal"
                                aria-label={label('grid.columnFull')}
                                aria-invalid={code === 'fullInvalid'}
                                value={c.full}
                                onChange={(e) =>
                                  patchComponent(block, c.key, { full: e.target.value })
                                }
                              />
                              {code === 'fullInvalid' && (
                                <p role="alert" className="mt-1 text-xs text-destructive">
                                  {t('grid.error.fullInvalid', { max: MAX_MARKS })}
                                </p>
                              )}
                            </TableCell>
                            <TableCell>
                              <Input
                                inputMode="decimal"
                                aria-label={label('grid.columnPass')}
                                aria-invalid={code === 'passInvalid'}
                                value={c.pass}
                                onChange={(e) =>
                                  patchComponent(block, c.key, { pass: e.target.value })
                                }
                                onKeyDown={(e) => {
                                  // Enter in the block's last cell appends a row.
                                  if (e.key === 'Enter' && isLast) {
                                    e.preventDefault();
                                    addComponent(block);
                                  }
                                }}
                              />
                              {code === 'passInvalid' && (
                                <p role="alert" className="mt-1 text-xs text-destructive">
                                  {t('grid.error.passInvalid')}
                                </p>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={t('grid.removeRow', {
                                  subject: heading,
                                  grade,
                                  row: index + 1,
                                })}
                                onClick={() =>
                                  patchBlock(block.key, (b) => ({
                                    ...b,
                                    components: b.components.filter((x) => x.key !== c.key),
                                  }))
                                }
                              >
                                {t('grid.removeRowShort')}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  {attempted && block.components.length === 0 && (
                    <p role="alert" className="text-xs text-destructive">
                      {t('grid.error.noComponents')}
                    </p>
                  )}
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addComponent(block)}
                    >
                      {t('grid.addComponent')}
                    </Button>
                  </div>
                </div>
              );
            })}

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={pickers[grade] ?? ''}
                onValueChange={(v) => setPickers({ ...pickers, [grade]: v })}
              >
                <SelectTrigger aria-label={t('grid.subjectPicker', { grade })} className="w-64">
                  <SelectValue placeholder={t('grid.subjectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {free.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.code} — {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                disabled={!pickers[grade]}
                onClick={() => addSubject(grade)}
              >
                {t('grid.addSubject')}
              </Button>
            </div>
          </section>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="template-grid-grade" className="text-sm font-medium">
          {t('grid.gradeLabel')}
        </label>
        <Input
          id="template-grid-grade"
          inputMode="numeric"
          className="w-24"
          aria-invalid={gradeError}
          value={gradeInput}
          onChange={(e) => setGradeInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addGrade();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={addGrade}>
          {t('grid.addGrade')}
        </Button>
        {gradeError && (
          <p role="alert" className="text-xs text-destructive">
            {t('grid.error.gradeInvalid')}
          </p>
        )}
      </div>

      {attempted && invalid && (
        <p role="alert" className="text-sm text-destructive">
          {t('grid.error.fixErrors')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={!dirty || saving} onClick={discard}>
          {t('grid.discard')}
        </Button>
        <Button type="button" loading={saving ?? false} disabled={!dirty} onClick={save}>
          {t('grid.save')}
        </Button>
      </div>
    </div>
  );
}
