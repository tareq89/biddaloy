/**
 * Epic 49 W4: "Revive school" — `POST /schools/:id/revive` (#2717) for a school the idle job
 * paused or soft-deleted. The reason (5-500) is audited server-side.
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import { useReviveSchool } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const FORM_ID = 'revive-school-form';

export interface ReviveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName: string;
}

export function ReviveDialog({ open, onOpenChange, schoolId, schoolName }: ReviveDialogProps) {
  const { t } = useTranslation('platform');
  const revive = useReviveSchool(schoolId);

  const schema = React.useMemo(
    () =>
      z.object({
        reason: z
          .string()
          .trim()
          .min(5, t('subscriptions.revive.errors.reasonLength'))
          .max(500, t('subscriptions.revive.errors.reasonLength')),
      }),
    [t],
  );
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(schema),
    defaultValues: { reason: '' },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({ reason: '' });
      revive.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  let errorSentence = t('subscriptions.revive.errors.generic');
  if (revive.error instanceof ApiError && revive.error.statusCode === 409) {
    const code = revive.error.details?.['code'];
    if (code === 'NOT_IDLE') errorSentence = t('subscriptions.revive.errors.notIdle');
    else if (code === 'REVIVE_WINDOW_PASSED') {
      errorSentence = t('subscriptions.revive.errors.windowPassed');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && revive.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="sm" showCloseButton={!revive.isPending}>
        <DialogHeader>
          <DialogTitle>{t('subscriptions.revive.title')}</DialogTitle>
          <DialogDescription>
            {t('subscriptions.revive.description', { name: schoolName })}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id={FORM_ID}
            noValidate
            onSubmit={(event) =>
              void form.handleSubmit((v) =>
                revive.mutate(
                  { reason: v.reason.trim() },
                  {
                    onSuccess: () => {
                      onOpenChange(false);
                      toast.success(t('subscriptions.revive.success'));
                    },
                  },
                ),
              )(event)
            }
          >
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="revive-reason">
                    {t('subscriptions.revive.reasonLabel')}
                  </FormLabel>
                  <FormControl>
                    <Textarea id="revive-reason" rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        {revive.isError && (
          <p role="alert" className="text-caption text-destructive">
            {errorSentence}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={revive.isPending}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="submit" form={FORM_ID} loading={revive.isPending}>
            {t('subscriptions.revive.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
