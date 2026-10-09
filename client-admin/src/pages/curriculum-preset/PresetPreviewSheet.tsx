/**
 * [35.4.3] Read-only preview of one pack. A choice group's members are shown
 * together as "One of: A / B / C" (amended 2026-10-02, #1296), not as
 * separate compulsory lines. Full-screen on phone, centred dialog from `sm`
 * (the app has no separate Sheet primitive; settings dialogs use `Dialog`).
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Skeleton,
  SkeletonText,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';

import { usePickText, usePresetPreview, type PresetPreview } from './use-presets';

export interface PresetPreviewSheetProps {
  /** `null` = closed. */
  presetId: string | null;
  /** Element to focus when the dialog closes (it has no Radix trigger to return to). */
  returnFocusTo?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function SubjectsByClass({ preview }: { preview: PresetPreview }) {
  const { t, i18n } = useTranslation('curriculumPreset');
  const config = useRegionConfig();
  const bn = i18n.language.startsWith('bn');
  const names = new Map(preview.subjects.map((s) => [s.code, bn ? s.nameBn : s.nameEn]));
  const rows = preview.classSubjects ?? [];
  const grades = [...new Set(rows.map((r) => r.classGrade))].sort((a, b) => a - b);

  return (
    <Section title={t('preview.subjectsByClass')}>
      <ul className="flex flex-col gap-2 text-sm">
        {grades.map((grade) => {
          const inClass = rows.filter((r) => r.classGrade === grade);
          const compulsory = inClass.filter((r) => !r.choiceGroup);
          const choices = new Map<string, string[]>();
          for (const r of inClass) {
            if (r.choiceGroup) {
              choices.set(r.choiceGroup, [
                ...(choices.get(r.choiceGroup) ?? []),
                names.get(r.subjectCode) ?? r.subjectCode,
              ]);
            }
          }
          return (
            <li key={grade}>
              <span className="font-medium">
                {t('preview.className', { grade: formatNumber(grade, config) })}
              </span>
              <ul className="ps-4">
                {compulsory.length > 0 && (
                  <li>
                    {compulsory.map((r) => names.get(r.subjectCode) ?? r.subjectCode).join(', ')}
                  </li>
                )}
                {[...choices.entries()].map(([group, members]) => (
                  <li key={group}>{t('preview.oneOf', { names: members.join(' / ') })}</li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function PresetPreviewSheet({ presetId, onClose, returnFocusTo }: PresetPreviewSheetProps) {
  const { t } = useTranslation('curriculumPreset');
  const config = useRegionConfig();
  const pick = usePickText();
  const query = usePresetPreview(presetId);
  const preview = query.data;

  return (
    <Dialog open={presetId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="h-dvh max-h-dvh w-full max-w-none overflow-y-auto rounded-none sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-lg"
        onCloseAutoFocus={(event) => {
          if (returnFocusTo?.current) {
            event.preventDefault();
            returnFocusTo.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {preview
              ? t('preview.title', { name: pick(preview.summary.name) })
              : t('cards.preview')}
          </DialogTitle>
          <DialogDescription>{preview ? pick(preview.summary.board) : ''}</DialogDescription>
        </DialogHeader>
        {query.isError ? (
          <ErrorState
            message={t('preview.loadError')}
            retryLabel={t('retry')}
            onRetry={() => void query.refetch()}
          />
        ) : !preview ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <Skeleton className="h-5 w-1/2" />
            <SkeletonText lines={4} />
          </div>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <Section title={t('preview.stages')}>
              <p>{preview.stages.map((s) => pick(s.name)).join(', ')}</p>
            </Section>
            <Section title={t('preview.classes')}>
              <p>{preview.classes.map((c) => c.name).join(', ')}</p>
            </Section>
            {preview.groups.length > 0 && (
              <Section title={t('preview.groups')}>
                <p>{preview.groups.join(', ')}</p>
              </Section>
            )}
            <p>{t('preview.subjects', { count: formatNumber(preview.counts.subjects, config) })}</p>
            {preview.classSubjects && <SubjectsByClass preview={preview} />}
            <Section title={t('preview.gradingScale')}>
              {preview.gradingScale ? (
                <ul>
                  {preview.gradingScale.bands.map((b) => (
                    <li key={b.grade}>
                      {t('preview.band', {
                        from: formatNumber(b.from, config),
                        to: formatNumber(b.to, config),
                        grade: b.grade,
                      })}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t('preview.noScale')}</p>
              )}
            </Section>
            <Section title={t('preview.examTemplates')}>
              <p>{preview.examTemplates.map((e) => e.name).join(', ') || t('preview.none')}</p>
            </Section>
            <Section title={t('preview.certificates')}>
              <p>
                {preview.certificates.map((c) => t(`preview.certificateKind.${c}`)).join(', ') ||
                  t('preview.none')}
              </p>
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
