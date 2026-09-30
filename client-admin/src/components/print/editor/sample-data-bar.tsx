/**
 * [32.3.2] What the canvas shows in the data fields (D14): stand-in text, a real
 * student (so a designer can check a real name and photo), or the LONGEST realistic
 * value of every field, which makes text that will not fit show up before printing.
 *
 * A real student needs a published version to preview against (the server builds the
 * values from it), so that picker is off until the first publish. Staff cards offer
 * the longest-values toggle only for now.
 */
import { DocumentKind } from '@biddaloy/shared';
import {
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { usePrintPreview, useStudents } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface SampleDataBarProps {
  kind: DocumentKind;
  templateId: string;
  /** Has the template been published at least once? */
  published: boolean;
  longest: boolean;
  onLongestChange: (value: boolean) => void;
  /** Values for the chosen student, or `null` to go back to stand-in text. */
  onSample: (values: Record<string, string> | null) => void;
}

const text = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return value == null ? '' : JSON.stringify(value);
};

export function SampleDataBar({
  kind,
  templateId,
  published,
  longest,
  onLongestChange,
  onSample,
}: SampleDataBarProps) {
  const { t } = useTranslation('printEditor');
  const isStudent = kind === DocumentKind.STUDENT_ID_CARD;
  const students = useStudents({ limit: 20 }, { enabled: isStudent && published });
  const preview = usePrintPreview();
  const [chosen, setChosen] = React.useState('');

  function choose(id: string) {
    if (id === '__none__') {
      setChosen('');
      onSample(null);
      return;
    }
    setChosen(id);
    preview.mutate(
      { template_id: templateId, subject_type: 'STUDENT', subject_ids: [id] },
      {
        onSuccess: (result) => {
          const values = result.items[0]?.values ?? {};
          onSample(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, text(v)])));
        },
      },
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span id="sample-label" className="text-sm font-medium">
        {t('sample.label')}
      </span>

      {isStudent ? (
        published ? (
          <Select value={chosen || '__none__'} onValueChange={choose}>
            <SelectTrigger aria-labelledby="sample-label" className="w-56">
              <SelectValue placeholder={t('sample.choose')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t('sample.none')}</SelectItem>
              {(students.data?.data ?? []).map((student) => (
                <SelectItem key={student.id} value={student.id}>
                  {student.full_name} · {student.registration_number}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">{t('sample.publishFirst')}</span>
        )
      ) : null}

      {preview.isError ? (
        <span role="alert" className="text-xs text-destructive">
          {t('sample.failed')}
        </span>
      ) : null}

      <div className="flex items-center gap-2 text-sm">
        <Checkbox
          id="sample-longest"
          checked={longest}
          aria-describedby="sample-longest-help"
          onCheckedChange={(next) => onLongestChange(next === true)}
        />
        <label htmlFor="sample-longest">{t('sample.longest')}</label>
      </div>
      <span id="sample-longest-help" className="sr-only">
        {t('sample.longestHelp')}
      </span>
    </div>
  );
}
