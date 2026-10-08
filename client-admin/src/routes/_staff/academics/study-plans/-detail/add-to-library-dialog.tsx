/**
 * [66.2] D4: turn the plan into a library template. Notifications have no
 * link slot, so success is shown in the dialog itself with the library link.
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@biddaloy/ui/components';
import { useCreateTemplateFromPlan, type StudyPlanDetail } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

import { DialogError } from './action-errors';

export interface AddToLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: StudyPlanDetail;
  /** "<subject> <class> — <term>" */
  defaultName: string;
}

export function AddToLibraryDialog({
  open,
  onOpenChange,
  plan,
  defaultName,
}: AddToLibraryDialogProps) {
  const { t } = useTranslation('studyPlans');
  const { t: tCommon } = useTranslation('common');
  const create = useCreateTemplateFromPlan(plan.id);
  const [name, setName] = React.useState(defaultName);

  React.useEffect(() => {
    if (!open) return;
    setName(defaultName);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open
  }, [open]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim() === '' || create.isPending) return;
    create.mutate({ name: name.trim() });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <DialogContent size="md" closeLabel={tCommon('actions.close')}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('addToLibrary.title')}</DialogTitle>
          </DialogHeader>

          {create.isSuccess ? (
            <p role="status">
              {t('addToLibrary.done')}{' '}
              <Link
                ref={(el) => el?.focus()}
                to={'/academics/syllabus?tab=library' as '/academics/syllabus'}
                className="underline"
              >
                {t('addToLibrary.open')}
              </Link>
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="library-name" className="text-label text-text-primary">
                {t('addToLibrary.name')}
              </label>
              <Input
                id="library-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={create.isPending}
              />
            </div>
          )}

          {create.isError && <DialogError>{tCommon('status.error')}</DialogError>}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={create.isPending}>
                {create.isSuccess ? tCommon('actions.close') : tCommon('actions.cancel')}
              </Button>
            </DialogClose>
            {!create.isSuccess && (
              <Button type="submit" loading={create.isPending} disabled={name.trim() === ''}>
                {t('actions.addToLibrary')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
