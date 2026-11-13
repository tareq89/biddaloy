import { LABEL_SUGGESTIONS, type LabelEntry, type LabelKey } from '@biddaloy/shared';
import { Button, ErrorState, Input, toast } from '@biddaloy/ui/components';
import { useSchoolProfile, useUpdateSchoolSettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

/** D17: the renamable words, in the order they show. shift/version/group are not here. */
const KEYS: readonly LabelKey[] = ['class', 'section', 'student', 'guardian', 'teacher'];
type Field = 'one' | 'other' | 'bn';
type Row = Record<Field, string>;
const FIELDS: readonly Field[] = ['one', 'other', 'bn'];
const FIELD_HEAD = { one: 'enOne', other: 'enMany', bn: 'bn' } as const;

/** Mirrors the server's `validText` (1 to 40 characters, trimmed, no HTML). Blank is allowed. */
const fieldInvalid = (v: string) => v !== '' && (v.length > 40 || /[<>]/.test(v));

interface WordsTabProps {
  schoolId: string;
}

/**
 * [77.4.04] D17/D18/D30: Settings › Modules & words › Words. Edit the fields, press Save: one PATCH
 * with only the rows that changed. A row left blank everywhere goes back to the stock word.
 */
export function WordsTab({ schoolId }: WordsTabProps) {
  const { t, i18n } = useTranslation('settings');
  const profile = useSchoolProfile();
  const qc = useQueryClient();
  const update = useUpdateSchoolSettings(schoolId);
  const [draft, setDraft] = React.useState<Partial<Record<LabelKey, Row>>>({});
  const [failed, setFailed] = React.useState(false);
  const [showInvalid, setShowInvalid] = React.useState(false);

  // What the screen says now (stock word, or the school's own once applyTenantWords has run).
  const en = i18n.getFixedT('en', 'common');
  const bn = i18n.getFixedT('bn', 'common');
  const current = (key: LabelKey): Row => ({
    one: en(`entities.${key}_one`),
    other: en(`entities.${key}_other`),
    bn: bn(`entities.${key}_one`),
  });
  const rowOf = (key: LabelKey): Row => draft[key] ?? current(key);
  const changed = KEYS.filter((k) => FIELDS.some((f) => rowOf(k)[f].trim() !== current(k)[f]));
  const invalid = KEYS.some((k) => FIELDS.some((f) => fieldInvalid(rowOf(k)[f].trim())));

  const edit = (key: LabelKey, patch: Partial<Row>) =>
    setDraft((d) => ({ ...d, [key]: { ...rowOf(key), ...patch } }));

  async function save() {
    if (invalid) {
      setShowInvalid(true);
      return;
    }
    // ponytail: the server cannot drop one word (`{en:{one:null}}`), so a row is either all
    // blank (the whole key goes, null) or sends the words that are filled.
    const labels: Record<string, LabelEntry | null> = {};
    for (const key of changed) {
      const r = rowOf(key);
      const [one, other, word] = [r.one.trim(), r.other.trim(), r.bn.trim()];
      labels[key] =
        !one && !other && !word
          ? null
          : {
              ...(one || other ? { en: { ...(one && { one }), ...(other && { other }) } } : {}),
              ...(word && { bn: word }),
            };
    }
    setFailed(false);
    try {
      // The mutation never retries (Rule 25): a failed PATCH is sent once.
      await update.mutateAsync({ version: 1, labels });
      // The refetch re-runs applyTenantWords, so menus and page titles change at once.
      await qc.invalidateQueries({ queryKey: ['school-profile'] });
      setDraft({});
      setShowInvalid(false);
      toast(t('modulesWords.words.saved'));
    } catch {
      setFailed(true);
    }
  }

  if (profile.isPending) return null;
  if (!profile.data) {
    return (
      <ErrorState
        message={t('modulesWords.modules.loadError')}
        onRetry={() => void profile.refetch()}
      />
    );
  }

  const heads = ['now', 'enOne', 'enMany', 'bn', 'suggestion'] as const;
  const cols = 'md:grid md:grid-cols-[8rem_1fr_1fr_1fr_12rem] md:items-start md:gap-3';
  return (
    <div className="space-y-4">
      <p className="text-text-secondary">{t('modulesWords.words.intro')}</p>
      <div
        role="table"
        aria-label={t('modulesWords.words.listTitle')}
        className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1"
      >
        <div
          role="row"
          className={`${cols} hidden border-b border-border-subtle bg-muted px-4 py-2 text-label text-text-secondary`}
        >
          {heads.map((h) => (
            <span key={h} role="columnheader">
              {t(`modulesWords.words.${h}`)}
            </span>
          ))}
        </div>
        <div className="divide-y divide-border-subtle">
          {KEYS.map((key) => {
            const r = rowOf(key);
            return (
              <div key={key} role="row" className={`${cols} space-y-3 p-4 md:space-y-0`}>
                <span role="rowheader" className="block font-medium text-text-primary">
                  {t(`modulesWords.labelNames.${key}`)}
                </span>
                {FIELDS.map((f) => {
                  const bad = showInvalid && fieldInvalid(r[f].trim());
                  const id = `word-${key}-${f}`;
                  return (
                    <div key={f} role="cell" className="flex flex-col gap-1.5">
                      <label htmlFor={id} className="text-label text-text-primary md:sr-only">
                        {t(`modulesWords.words.${FIELD_HEAD[f]}`)}
                      </label>
                      <Input
                        id={id}
                        className="min-h-11 md:min-h-8"
                        value={r[f]}
                        aria-invalid={bad || undefined}
                        aria-describedby={bad ? `${id}-err` : undefined}
                        onChange={(e) => edit(key, { [f]: e.target.value })}
                      />
                      {bad && (
                        <span id={`${id}-err`} role="alert" className="text-destructive">
                          {t('modulesWords.words.invalid')}
                        </span>
                      )}
                    </div>
                  );
                })}
                <div role="cell" className="flex flex-col items-start gap-2">
                  {(LABEL_SUGGESTIONS[key] ?? []).map((s) => (
                    <Button
                      key={s.en?.one}
                      type="button"
                      variant="outline"
                      className="min-h-11 md:min-h-8"
                      onClick={() =>
                        edit(key, {
                          one: s.en?.one ?? '',
                          other: s.en?.other ?? '',
                          bn: s.bn ?? '',
                        })
                      }
                    >
                      {s.bn} / {s.en?.one}
                    </Button>
                  ))}
                  {/* The typed word renders as text (React escapes it), never as HTML. */}
                  <p className="text-text-secondary">
                    {t('modulesWords.words.example')}{' '}
                    <span className="font-medium text-text-primary">
                      {t('modulesWords.words.exampleValue', {
                        word: r.other.trim() || current(key).other,
                        interpolation: { escapeValue: false },
                      })}
                    </span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {failed && (
        <p role="alert" className="text-destructive">
          {t('modulesWords.words.notSaved')}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          className="min-h-11 w-full md:w-auto"
          disabled={changed.length === 0 || update.isPending}
          onClick={() => void save()}
        >
          {t('modulesWords.words.save')}
        </Button>
      </div>
    </div>
  );
}
