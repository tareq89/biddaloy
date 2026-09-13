/**
 * [16.3.7] Per-row kebab menu for the generation log page (16.3.4/#654):
 * "Edit period/due date", "Remove uncollected", "Delete batch".
 *
 * A standalone component rather than a `batch-table.tsx` column definition
 * — this ticket doesn't own that file (#654 does, in parallel); #654 wires
 * `<BatchActions />` into its `actions` column cell.
 *
 * "Remove uncollected" and "Delete batch" are both simple confirm dialogs
 * (no separate file per the ticket's `## Files` list) built directly with
 * `Dialog`, same shape as `-delete-structure-dialog.tsx`. "Edit period/due
 * date" opens `EditBatchDialog`, its own file, since that one needs a real
 * form.
 *
 * **Only one dialog's `useApprovedMutation` is ever mounted at a time.**
 * `approval.tsx`'s `useIsModalHost` hands the single approval-modal "host"
 * slot to whichever `useApprovedMutation` instance mounts first and never
 * hands it back while that instance stays mounted — it's built for one
 * approvable action live on screen, not three sharing a row's kebab menu.
 * Rendering `EditBatchDialog`/the remove-uncollected confirm/the delete
 * confirm unconditionally (each always calling its own
 * `useApprovedMutation`) would let whichever mounts first at component
 * mount time permanently squat the host, silently breaking the other two
 * mutations' approval flow. Each of the three dialogs below is only
 * rendered — and so only calls its mutation hook — while `openDialog`
 * actually selects it, so exactly one is ever mounted.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from '@biddaloy/ui/components';
import { useDeleteFeeGeneration, useRemoveUncollected } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { MoreVertical } from 'lucide-react';
import * as React from 'react';

import { EditBatchDialog, type EditBatchDialogGeneration } from './edit-batch-dialog';

export interface BatchActionsGeneration extends EditBatchDialogGeneration {
  student_count: number;
  generated_count: number;
  /** How many of this batch's bills already have money against them —
   * drives both the confirm copy (#651 plan step 3: "3 of 30 bills already
   * have payments — admin approval will be required") and whether
   * `EditBatchDialog`/the delete dialog warn about approval up front. */
  collected_count: number;
}

export interface BatchActionsProps {
  generation: BatchActionsGeneration;
  onChanged: () => void;
}

type OpenDialog = 'edit' | 'remove-uncollected' | 'delete' | null;

export function BatchActions({ generation, onChanged }: BatchActionsProps) {
  const { t } = useTranslation('fees');
  const [openDialog, setOpenDialog] = React.useState<OpenDialog>(null);

  const hasCollectedBills = generation.collected_count > 0;

  function close() {
    setOpenDialog(null);
  }

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            iconOnly
            aria-label={t('generations.batchActions.menuLabel')}
          >
            <MoreVertical aria-hidden="true" />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={() => setOpenDialog('edit')}>
            {t('generations.batchActions.editPeriod')}
          </MenuItem>
          <MenuItem onSelect={() => setOpenDialog('remove-uncollected')}>
            {t('generations.batchActions.removeUncollected')}
          </MenuItem>
          <MenuItem onSelect={() => setOpenDialog('delete')} className="text-destructive">
            {t('generations.batchActions.deleteBatch')}
          </MenuItem>
        </MenuContent>
      </Menu>

      {openDialog === 'edit' && (
        <EditBatchDialog
          open
          onOpenChange={(open) => !open && close()}
          generation={generation}
          hasCollectedBills={hasCollectedBills}
          onSaved={() => {
            onChanged();
            close();
          }}
        />
      )}

      {openDialog === 'remove-uncollected' && (
        <RemoveUncollectedConfirmDialog
          generationId={generation.id}
          onOpenChange={(open) => !open && close()}
          onRemoved={() => {
            onChanged();
            close();
          }}
        />
      )}

      {openDialog === 'delete' && (
        <DeleteBatchConfirmDialog
          generation={generation}
          hasCollectedBills={hasCollectedBills}
          onOpenChange={(open) => !open && close()}
          onDeleted={() => {
            onChanged();
            close();
          }}
        />
      )}
    </>
  );
}

interface RemoveUncollectedConfirmDialogProps {
  generationId: string;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}

function RemoveUncollectedConfirmDialog({
  generationId,
  onOpenChange,
  onRemoved,
}: RemoveUncollectedConfirmDialogProps) {
  const { t } = useTranslation('fees');
  const removeUncollected = useRemoveUncollected();

  function handleConfirm() {
    removeUncollected.mutate(generationId, { onSuccess: onRemoved });
  }

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('generations.removeUncollectedDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('generations.removeUncollectedDialog.description')}
            </DialogDescription>
          </DialogHeader>
          {removeUncollected.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('generations.removeUncollectedDialog.errorMessage')}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              loading={removeUncollected.isPending}
              onClick={handleConfirm}
            >
              {removeUncollected.isPending
                ? t('generations.removeUncollectedDialog.removing')
                : t('generations.removeUncollectedDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {removeUncollected.modal}
    </>
  );
}

interface DeleteBatchConfirmDialogProps {
  generation: BatchActionsGeneration;
  hasCollectedBills: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

function DeleteBatchConfirmDialog({
  generation,
  hasCollectedBills,
  onOpenChange,
  onDeleted,
}: DeleteBatchConfirmDialogProps) {
  const { t } = useTranslation('fees');
  const deleteGeneration = useDeleteFeeGeneration();

  function handleConfirm() {
    deleteGeneration.mutate(generation.id, { onSuccess: onDeleted });
  }

  const isConflict =
    deleteGeneration.error instanceof ApiError && deleteGeneration.error.statusCode === 409;

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('generations.deleteBatchDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('generations.deleteBatchDialog.description', {
                count: generation.student_count,
              })}
            </DialogDescription>
          </DialogHeader>
          {hasCollectedBills && (
            <p className="text-sm text-muted-foreground">
              {t('generations.deleteBatchDialog.approvalNotice', {
                collected: generation.collected_count,
                generated: generation.generated_count,
              })}
            </p>
          )}
          {deleteGeneration.isError && (
            <p role="alert" className="text-sm text-destructive">
              {isConflict
                ? t('generations.deleteBatchDialog.errorConflict')
                : t('generations.deleteBatchDialog.errorMessage')}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              loading={deleteGeneration.isPending}
              onClick={handleConfirm}
            >
              {deleteGeneration.isPending
                ? t('generations.deleteBatchDialog.deleting')
                : t('generations.deleteBatchDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {deleteGeneration.modal}
    </>
  );
}
