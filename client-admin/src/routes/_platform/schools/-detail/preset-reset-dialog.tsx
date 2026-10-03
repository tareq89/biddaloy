/**
 * [35.4.4/#1284] Destructive confirm dialog for "reset curriculum preset".
 * Same RHF + zod reason-textarea shape as `status-action-dialog.tsx`, but the
 * bound is 10-500 (the server's `ResetPresetDto`) with a live counter.
 * A 409 keeps the dialog open and shows why (blockers / nothing to reset).
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
  toast,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { classifyResetError, useResetPreset, type ResetPresetFailure } from './use-reset-preset';

export const RESET_REASON_MIN = 10;
export const RESET_REASON_MAX = 500;

type ReasonValues = { reason: string };

export interface PresetResetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName: string;
}

export function PresetResetDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
}: PresetResetDialogProps) {
  const { t } = useTranslation('presetReset');
  const reset = useResetPreset(schoolId);
  const [failure, setFailure] = React.useState<ResetPresetFailure | null>(null);

  const reasonSchema = React.useMemo(
    () =>
      z.object({
        reason: z
          .string()
          .trim()
          .min(RESET_REASON_MIN, t('dialog.reasonTooShort', { min: RESET_REASON_MIN }))
          .max(RESET_REASON_MAX, t('dialog.reasonTooLong', { max: RESET_REASON_MAX })),
      }),
    [t],
  );

  const form = useForm<ReasonValues>({
    resolver: zodResolver(reasonSchema),
    defaultValues: { reason: '' },
    mode: 'onChange',
  });
  const length = form.watch('reason').trim().length;

  React.useEffect(() => {
    if (open) {
      form.reset({ reason: '' });
      reset.reset();
      setFailure(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(values: ReasonValues) {
    setFailure(null);
    reset.mutate(
      { reason: values.reason },
      {
        onSuccess: ({ deleted }) => {
          const total = Object.values(deleted).reduce((sum: number, n: number) => sum + n, 0);
          onOpenChange(false);
          toast.success(t('success', { count: total }));
        },
        onError: (error: unknown) => setFailure(classifyResetError(error)),
      },
    );
  }

  const blockedAlready = failure?.kind === 'notApplied';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Don't let the dialog be dismissed while the destructive request is in flight.
        if (!next && reset.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dialog.title')}</DialogTitle>
          <DialogDescription>{t('dialog.description', { name: schoolName })}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium text-destructive">{t('dialog.deletesHeading')}</p>
          <p>{t('dialog.deletes')}</p>
          <p className="text-muted-foreground">{t('dialog.blocksWhen')}</p>
        </div>

        <Form {...form}>
          <form
            id="preset-reset-form"
            onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
          >
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="preset-reset-reason">{t('dialog.reasonLabel')}</FormLabel>
                  <FormControl>
                    <Textarea
                      id="preset-reset-reason"
                      rows={4}
                      aria-describedby="preset-reset-count"
                      {...field}
                    />
                  </FormControl>
                  <p id="preset-reset-count" className="text-xs text-muted-foreground">
                    {t('dialog.reasonCount', {
                      count: length,
                      min: RESET_REASON_MIN,
                      max: RESET_REASON_MAX,
                    })}
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        {failure?.kind === 'blocked' && (
          <div role="alert" className="flex flex-col gap-1 text-sm">
            <p className="font-medium text-destructive">{t('blocked.heading')}</p>
            <ul className="list-disc ps-5">
              {failure.blockers.map((b) => (
                <li key={b.entity}>
                  <span>
                    {t(`blocked.entities.${b.entity.replaceAll(' ', '_')}`, {
                      defaultValue: b.entity,
                    })}
                  </span>
                  {' — '}
                  <span className="tabular-nums">{b.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {failure?.kind === 'notApplied' && (
          <p role="alert" className="text-sm text-destructive">
            {t('notApplied')}
          </p>
        )}
        {failure?.kind === 'generic' && (
          <p role="alert" className="text-sm text-destructive">
            {t('error')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={reset.isPending}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="preset-reset-form"
            variant="destructive"
            loading={reset.isPending}
            disabled={length < RESET_REASON_MIN || length > RESET_REASON_MAX || blockedAlready}
          >
            {t('dialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
