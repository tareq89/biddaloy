/**
 * [71.4.07] Marks entry for one stage: one row per applicant who reached the stage, one cell per
 * roll. Arrow keys and Enter move down the column, `A` marks absent, a cell above the full marks
 * turns red and blocks saving. Saves in chunks of 200 (the server cap, Rule 5). Pass/fail stages
 * show two big buttons per row instead of a number.
 */
import { Button } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, renderDigits, toLatinDigits } from '@biddaloy/ui/utils';
import * as React from 'react';

export interface GridApplicant {
  id: string;
  roll: string | null;
  name: string;
}
export interface SavedResult {
  attended: boolean;
  score: number | null;
  passed: boolean | null;
}
export interface ResultRowInput {
  applicant_id: string;
  attended: boolean;
  score?: number;
  passed?: boolean;
}
interface Edit {
  absent: boolean;
  text: string;
  passed: boolean | null;
}

export const SAVE_CHUNK = 200;
/** Split rows into server-sized chunks (Rule 5). */
export function chunk<T>(rows: T[], size = SAVE_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
const NUMBER = /^\d*\.?\d{0,2}$/;

export interface StageScoreGridProps {
  applicants: GridApplicant[];
  saved: ReadonlyMap<string, SavedResult>;
  maxScore: number | null;
  passFail: boolean;
  /** Send one chunk (at most 200 rows). */
  onSave: (rows: ResultRowInput[]) => Promise<unknown>;
}

function cellError(text: string, max: number | null): 'invalid' | 'range' | null {
  if (text === '') return null;
  if (text === '.') return 'invalid';
  const n = Number(text);
  if (!Number.isFinite(n)) return 'invalid';
  if (max !== null && n > max) return 'range';
  return null;
}

export function StageScoreGrid({
  applicants,
  saved,
  maxScore,
  passFail,
  onSave,
}: StageScoreGridProps) {
  const { t } = useTranslation('admission-stages');
  const region = useRegionConfig();
  const [edits, setEdits] = React.useState<Map<string, Edit>>(new Map());
  const [status, setStatus] = React.useState<
    'idle' | 'saving' | 'saved' | 'error' | 'fix' | 'none' | 'cleared'
  >('idle');
  const [savedCount, setSavedCount] = React.useState(0);
  const inputs = React.useRef(new Map<number, HTMLInputElement>());

  const current = (a: GridApplicant): Edit => {
    const e = edits.get(a.id);
    if (e) return e;
    const s = saved.get(a.id);
    return {
      absent: s ? !s.attended : false,
      text: s?.score != null ? String(s.score) : '',
      passed: s?.passed ?? null,
    };
  };
  const patch = (id: string, base: Edit, next: Partial<Edit>) => {
    setStatus('idle');
    setEdits((prev) => new Map(prev).set(id, { ...base, ...next }));
  };

  function focusFrom(row: number, step: 1 | -1) {
    for (let i = row + step; i >= 0 && i < applicants.length; i += step) {
      const el = inputs.current.get(i);
      if (el && !el.disabled) {
        el.focus();
        return;
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>, row: number, a: GridApplicant) {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusFrom(row, 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusFrom(row, -1);
    } else if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      patch(a.id, current(a), { absent: true, text: '', passed: null });
      focusFrom(row, 1);
    }
  }

  async function save() {
    const rows: ResultRowInput[] = [];
    for (const a of applicants) {
      const e = edits.get(a.id);
      if (!e) continue;
      if (e.absent) rows.push({ applicant_id: a.id, attended: false });
      else if (passFail) {
        if (e.passed !== null) rows.push({ applicant_id: a.id, attended: true, passed: e.passed });
      } else if (e.text === '' && saved.get(a.id)?.score != null) {
        // A saved mark cannot be erased (the server has no "clear"): say so, never keep it silently.
        setStatus('cleared');
        return;
      } else if (e.text !== '') {
        if (cellError(e.text, maxScore)) {
          setStatus('fix');
          return;
        }
        rows.push({ applicant_id: a.id, attended: true, score: Number(e.text) });
      }
    }
    if (rows.length === 0) {
      setStatus('none');
      return;
    }
    setStatus('saving');
    try {
      for (const part of chunk(rows)) await onSave(part);
      setEdits(new Map());
      setSavedCount(rows.length);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  const marksHead =
    maxScore === null
      ? t('grid.marksNoMax')
      : t('grid.marks', { max: formatNumber(maxScore, region, { decimals: 0 }) });
  const hasError = applicants.some((a) => cellError(current(a).text, maxScore));

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border-functional bg-surface">
        <table className="w-full border-collapse text-body">
          <caption className="sr-only">{t('grid.caption')}</caption>
          <thead>
            <tr className="bg-muted text-label text-text-secondary">
              <th scope="col" className="h-10 px-4 text-start font-medium">
                {t('grid.roll')}
              </th>
              <th scope="col" className="h-10 px-4 text-start font-medium">
                {t('grid.name')}
              </th>
              <th scope="col" className="h-10 px-4 text-start font-medium">
                {passFail ? t('grid.pass') : marksHead}
              </th>
              <th scope="col" className="h-10 px-4 text-start font-medium">
                {t('grid.absent')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {applicants.map((a, row) => {
              const cur = current(a);
              const err = passFail ? null : cellError(cur.text, maxScore);
              return (
                <tr key={a.id}>
                  <td className="px-4 py-1.5 tabular-nums">
                    {a.roll ? renderDigits(a.roll, region.numerals) : t('grid.noRoll')}
                  </td>
                  <td className="px-4 py-1.5 font-medium">{a.name}</td>
                  <td className="px-4 py-1.5 align-top">
                    {passFail ? (
                      <div className="flex gap-2">
                        {[true, false].map((v) => (
                          <Button
                            key={String(v)}
                            type="button"
                            size="lg"
                            variant={cur.passed === v && !cur.absent ? 'default' : 'outline'}
                            aria-pressed={cur.passed === v && !cur.absent}
                            disabled={cur.absent}
                            onClick={() => patch(a.id, cur, { passed: v })}
                          >
                            {v ? t('grid.pass') : t('grid.fail')}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <>
                        <input
                          ref={(el) => {
                            if (el) inputs.current.set(row, el);
                            else inputs.current.delete(row);
                          }}
                          type="text"
                          inputMode="decimal"
                          disabled={cur.absent}
                          aria-label={t('grid.cellLabel', {
                            roll: a.roll ?? t('grid.noRoll'),
                            name: a.name,
                          })}
                          aria-invalid={err ? true : undefined}
                          value={renderDigits(cur.text, region.numerals)}
                          className={`h-8 w-24 rounded-md border bg-surface px-2 text-end tabular-nums ${
                            err ? 'border-destructive' : 'border-border-functional'
                          }`}
                          onChange={(ev) => {
                            const typed = toLatinDigits(ev.target.value);
                            if (typed === '' || NUMBER.test(typed))
                              patch(a.id, cur, { text: typed, absent: false });
                          }}
                          onKeyDown={(ev) => onKeyDown(ev, row, a)}
                        />
                        {err ? (
                          <p className="text-caption text-destructive" role="alert">
                            {err === 'range'
                              ? t('grid.outOfRange', {
                                  max: formatNumber(maxScore ?? 0, region, { decimals: 0 }),
                                })
                              : t('grid.invalid')}
                          </p>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-1.5 align-top">
                    <input
                      type="checkbox"
                      aria-label={t('grid.absentLabel', { name: a.name })}
                      checked={cur.absent}
                      onChange={(ev) =>
                        patch(a.id, cur, {
                          absent: ev.target.checked,
                          text: ev.target.checked ? '' : cur.text,
                          passed: ev.target.checked ? null : cur.passed,
                        })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void save()} disabled={status === 'saving'}>
          {status === 'saving' ? t('grid.saving') : t('grid.save')}
        </Button>
        <span role="status" className="text-sm">
          {status === 'saved' ? t('grid.saved', { count: savedCount }) : null}
          {status === 'none' ? t('grid.nothingToSave') : null}
          {status === 'cleared' ? t('grid.cleared') : null}
          {status === 'fix' || (hasError && status === 'idle') ? t('grid.fixFirst') : null}
        </span>
        {status === 'error' ? (
          <span role="alert" className="text-sm text-destructive">
            {t('grid.saveError')}
          </span>
        ) : null}
      </div>
    </div>
  );
}
