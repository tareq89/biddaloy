/**
 * #535's suspend/reactivate confirm dialog. `PATCH /schools/:id/status`
 * (#530's `UpdateSchoolStatusDto`) makes `reason` mandatory in both
 * directions, `Length(5, 500)` — this dialog mirrors that bound with a
 * Zod schema (same "hand-typed against the DTO" precedent
 * `-create-school-wizard.tsx`'s `schoolStepSchema` documents) so a
 * too-short/too-long reason is caught before the request goes out, not
 * just after the server's own 400.
 *
 * RHF + zodResolver, same shape as the wizard's own forms — a plain
 * `<textarea>` inside `FormControl` rather than a whole `FormShell`,
 * since this is one field in a dialog, not a page-level form.
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Textarea,
} from '@biddaloy/ui/components';
import { useUpdateSchoolStatus, type SchoolStatusResult } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const reasonSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

type ReasonValues = z.infer<typeof reasonSchema>;

export interface StatusActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName: string;
  /** The status this action would move the school *to* — 'SUSPENDED' for
   * the Suspend action, 'ACTIVE' for Reactivate. */
  targetStatus: 'ACTIVE' | 'SUSPENDED';
  onUpdated?: (result: SchoolStatusResult) => void;
}

export function StatusActionDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  targetStatus,
  onUpdated,
}: StatusActionDialogProps) {
  const { t } = useTranslation('platform');
  const updateStatus = useUpdateSchoolStatus(schoolId);

  const form = useForm<ReasonValues>({
    resolver: zodResolver(reasonSchema),
    defaultValues: { reason: '' },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({ reason: '' });
      updateStatus.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(values: ReasonValues) {
    updateStatus.mutate(
      { status: targetStatus, reason: values.reason },
      {
        onSuccess: (result: SchoolStatusResult) => {
          onOpenChange(false);
          onUpdated?.(result);
        },
      },
    );
  }

  const isSuspend = targetStatus === 'SUSPENDED';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isSuspend
              ? t('schoolDetail.suspendDialog.title')
              : t('schoolDetail.reactivateDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {isSuspend
              ? t('schoolDetail.suspendDialog.description', { name: schoolName })
              : t('schoolDetail.reactivateDialog.description', { name: schoolName })}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="status-action-form"
            onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
          >
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="status-action-reason">
                    {t('schoolDetail.statusDialog.reasonLabel')}
                  </FormLabel>
                  <FormControl>
                    <Textarea id="status-action-reason" rows={4} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        {updateStatus.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('schoolDetail.statusDialog.error')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="status-action-form"
            variant={isSuspend ? 'destructive' : 'default'}
            loading={updateStatus.isPending}
          >
            {isSuspend
              ? t('schoolDetail.suspendDialog.confirm')
              : t('schoolDetail.reactivateDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
