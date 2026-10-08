/**
 * [66.2] D18: copy the plan to another section the same teacher teaches the
 * same subject in. Sections of the same class come first, then every other.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Combobox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import {
  useClassSections,
  useCopyStudyPlanToSection,
  useSectionLookup,
  type StudyPlanDetail,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { subjectName } from '../../homework/-subject-name';

import { DialogError, errorCode } from './action-errors';

export interface CopyToSectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: StudyPlanDetail;
}

export function CopyToSectionDialog({ open, onOpenChange, plan }: CopyToSectionDialogProps) {
  const { t, i18n } = useTranslation('studyPlans');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const copy = useCopyStudyPlanToSection(plan.id);
  const lookup = useSectionLookup().data ?? {};
  const sameClassIds = new Set(
    (useClassSections(plan.section.class_id).data ?? []).map((s) => s.id),
  );

  const [sectionId, setSectionId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setSectionId(null);
    copy.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open
  }, [open]);

  const options = Object.entries(lookup)
    .filter(([id]) => id !== plan.section.id)
    .map(([id, s]) => ({
      value: id,
      label: `${s.className}-${s.sectionName}`,
      same: sameClassIds.has(id),
    }))
    .sort((a, b) => Number(b.same) - Number(a.same) || a.label.localeCompare(b.label));

  const code = errorCode(copy.error);
  const existingId = copy.error instanceof ApiError ? copy.error.details?.existing_id : undefined;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sectionId === null || copy.isPending) return;
    copy.mutate(
      { section_id: sectionId },
      {
        onSuccess: (created) => {
          onOpenChange(false);
          void navigate({ to: '/academics/study-plans/$planId', params: { planId: created.id } });
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !copy.isPending && onOpenChange(next)}>
      <DialogContent size="md" closeLabel={tCommon('actions.close')}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('copy.title')}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="copy-section" className="text-label text-text-primary">
              {t('copy.section')}
            </label>
            <Combobox
              id="copy-section"
              aria-label={t('copy.section')}
              options={options}
              value={sectionId}
              onValueChange={setSectionId}
              disabled={copy.isPending}
            />
          </div>

          {copy.isError && (
            <DialogError>
              {code === 'STUDY_PLAN_OUT_OF_SCOPE' &&
                t('copy.notYours', { subject: subjectName(plan.subject, i18n.language) })}
              {code === 'STUDY_PLAN_EXISTS' && (
                <>
                  {t('copy.exists')}{' '}
                  {typeof existingId === 'string' && (
                    <Link
                      to="/academics/study-plans/$planId"
                      params={{ planId: existingId }}
                      className="underline"
                    >
                      {t('copy.openExisting')}
                    </Link>
                  )}
                </>
              )}
              {code !== 'STUDY_PLAN_OUT_OF_SCOPE' &&
                code !== 'STUDY_PLAN_EXISTS' &&
                tCommon('status.error')}
            </DialogError>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={copy.isPending}>
                {tCommon('actions.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" loading={copy.isPending} disabled={sectionId === null}>
              {t('copy.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
