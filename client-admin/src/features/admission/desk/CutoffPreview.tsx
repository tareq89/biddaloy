/**
 * [71.4.07] Cut-off: choose the top N or a lowest mark, see who goes on and who is left out,
 * move single people by hand, then confirm. Nothing is saved until "Confirm".
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@biddaloy/ui/components';
import {
  useCommitCutoff,
  useCutoffPreview,
  type CutoffPreview as Preview,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, renderDigits, toLatinDigits } from '@biddaloy/ui/utils';
import * as React from 'react';

const isIncomplete = (e: unknown) =>
  e instanceof ApiError && e.details?.code === 'ADMISSION_RESULTS_INCOMPLETE';

type Mode = 'TOP_N' | 'MIN_SCORE';
type Row = Preview['passing_rows'][number];
/** Server cap on `add` / `remove` (Rule 5). */
const MANUAL_CAP = 200;

export function CutoffPreview({ stageId }: { stageId: string }) {
  const { t } = useTranslation('admission-stages');
  const region = useRegionConfig();
  const previewM = useCutoffPreview(stageId);
  const commitM = useCommitCutoff(stageId);
  const [mode, setMode] = React.useState<Mode>('TOP_N');
  const [text, setText] = React.useState('');
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [add, setAdd] = React.useState<Set<string>>(new Set());
  const [remove, setRemove] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<'preview' | 'commit' | 'incomplete' | null>(null);
  const [done, setDone] = React.useState<{ pass: number; fail: number } | null>(null);

  const value = Number(text);
  const valid =
    text !== '' &&
    Number.isFinite(value) &&
    value >= 0 &&
    (mode === 'MIN_SCORE' || Number.isInteger(value));

  const reset = () => {
    setPreview(null);
    setAdd(new Set());
    setRemove(new Set());
    setError(null);
    setDone(null);
  };

  async function show() {
    reset();
    try {
      setPreview(await previewM.mutateAsync({ mode, value }));
    } catch (e) {
      setError(isIncomplete(e) ? 'incomplete' : 'preview');
    }
  }

  async function confirm() {
    setError(null);
    try {
      const res = await commitM.mutateAsync({
        mode,
        value,
        ...(add.size ? { add: [...add] } : {}),
        ...(remove.size ? { remove: [...remove] } : {}),
      });
      setPreview(null);
      setAdd(new Set());
      setRemove(new Set());
      setDone({ pass: res.passed, fail: res.failed });
      toast.success(t('cutoff.confirmed', { pass: num(res.passed), fail: num(res.failed) }));
    } catch (e) {
      setError(isIncomplete(e) ? 'incomplete' : 'commit');
    }
  }

  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    fn(next);
  };

  let passing: Row[] = [];
  let failing: Row[] = [];
  if (preview) {
    passing = [
      ...preview.passing_rows.filter((r) => !remove.has(r.applicant_id)),
      ...preview.failing_rows.filter((r) => add.has(r.applicant_id)),
    ];
    failing = [
      ...preview.failing_rows.filter((r) => !add.has(r.applicant_id)),
      ...preview.passing_rows.filter((r) => remove.has(r.applicant_id)),
    ];
  }
  const num = (n: number) => formatNumber(n, region);
  const person = (r: Row) =>
    `${r.roll ? renderDigits(r.roll, region.numerals) : t('grid.noRoll')} ${r.name}`;

  const list = (rows: Row[], from: 'pass' | 'fail') => (
    <section className="flex flex-col gap-1">
      <h4 className="font-medium">{from === 'pass' ? t('cutoff.passing') : t('cutoff.failing')}</h4>
      {rows.length === 0 ? <p className="text-sm">{t('cutoff.none')}</p> : null}
      <ul className="max-h-64 divide-y overflow-auto rounded-md border">
        {rows.map((r) => {
          const moved = from === 'pass' ? add.has(r.applicant_id) : remove.has(r.applicant_id);
          // A passing-side row is "added" if it came from failing; a failing-side row is
          // "removed" if it came from passing. Undo flips it back.
          const undoSet = from === 'pass' ? add : remove;
          const manualSet = from === 'pass' ? remove : add;
          const capped = !moved && manualSet.size >= MANUAL_CAP;
          return (
            <li key={r.applicant_id} className="flex items-center justify-between gap-2 px-2 py-1">
              <span>
                {person(r)}
                {moved ? (
                  <span className="ms-2 text-caption text-text-secondary">
                    {from === 'pass' ? t('cutoff.added') : t('cutoff.removed')}
                  </span>
                ) : null}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={capped}
                onClick={() =>
                  moved
                    ? toggle(undoSet, r.applicant_id, from === 'pass' ? setAdd : setRemove)
                    : toggle(manualSet, r.applicant_id, from === 'pass' ? setRemove : setAdd)
                }
              >
                {moved ? t('cutoff.undo') : from === 'pass' ? t('cutoff.remove') : t('cutoff.add')}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );

  return (
    <section aria-label={t('cutoff.title')} className="flex flex-col gap-3 rounded-md border p-3">
      <h3 className="font-semibold">{t('cutoff.title')}</h3>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 text-sm">
          {t('cutoff.mode')}
          <Select
            value={mode}
            onValueChange={(v) => {
              setMode(v as Mode);
              reset();
            }}
          >
            <SelectTrigger aria-label={t('cutoff.mode')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TOP_N">{t('cutoff.topN')}</SelectItem>
              <SelectItem value="MIN_SCORE">{t('cutoff.minScore')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          {t('cutoff.value')}
          <Input
            inputMode="decimal"
            value={renderDigits(text, region.numerals)}
            onChange={(e) => {
              const typed = toLatinDigits(e.target.value);
              if (/^\d*\.?\d{0,2}$/.test(typed)) {
                setText(typed);
                reset();
              }
            }}
          />
        </label>
        <Button
          variant="outline"
          disabled={!valid || previewM.isPending}
          onClick={() => void show()}
        >
          {t('cutoff.show')}
        </Button>
      </div>
      {error === 'preview' ? <p role="alert">{t('cutoff.previewError')}</p> : null}
      {error === 'incomplete' ? <p role="alert">{t('cutoff.scoreMissing')}</p> : null}
      {done ? (
        <p role="status">{t('cutoff.confirmed', { pass: num(done.pass), fail: num(done.fail) })}</p>
      ) : null}
      {preview ? (
        <div className="flex flex-col gap-3">
          <p role="status" className="text-lg font-semibold">
            {t('cutoff.summary', { pass: num(passing.length), fail: num(failing.length) })}
          </p>
          <p className="text-sm">
            {preview.boundary_score === null
              ? t('cutoff.noBoundary')
              : t('cutoff.boundary', {
                  score: num(preview.boundary_score),
                  tied: num(preview.tied_at_boundary),
                })}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {list(passing, 'pass')}
            {list(failing, 'fail')}
          </div>
          {error === 'commit' ? <p role="alert">{t('cutoff.commitError')}</p> : null}

          <div>
            <Button disabled={commitM.isPending} onClick={() => void confirm()}>
              {t('cutoff.confirm')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
