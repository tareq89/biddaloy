/**
 * #3886 Move a school to another plan (D26). Mounted by #3888 on the school billing detail:
 * `<PlanChangeDialog schoolId schoolName currentPlanId open onOpenChange />`. Lists active plans only
 * and needs a reason (5-300). `useApprovedMutation` (scope `platform.plan`); a failure is one fixed
 * sentence (Rule 23). The change prices the next order only.
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import { useChangeSchoolPlan, usePlatformPlans } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const FORM_ID = 'plan-change-form';

export interface PlanChangeDialogProps {
  schoolId: string;
  schoolName: string;
  currentPlanId?: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlanChangeDialog({
  schoolId,
  schoolName,
  currentPlanId,
  open,
  onOpenChange,
}: PlanChangeDialogProps) {
  const { t } = useTranslation('moneyPlans');
  const config = useRegionConfig();
  const plans = usePlatformPlans();
  const change = useChangeSchoolPlan(schoolId);
  const active = (plans.data ?? []).filter((p) => p.active);

  const schema = React.useMemo(
    () =>
      z.object({
        plan_id: z.string().min(1, t('change.errors.plan')),
        reason: z
          .string()
          .trim()
          .min(5, t('change.errors.reason'))
          .max(300, t('change.errors.reason')),
      }),
    [t],
  );
  const form = useForm<{ plan_id: string; reason: string }>({
    resolver: zodResolver(schema),
    defaultValues: { plan_id: currentPlanId ?? '', reason: '' },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({ plan_id: currentPlanId ?? '', reason: '' });
      change.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open, currentPlanId]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && change.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        size="sm"
        showCloseButton={!change.isPending}
        className="max-md:w-full max-md:max-w-full"
      >
        <DialogHeader>
          <DialogTitle>{t('change.title', { name: schoolName })}</DialogTitle>
          <DialogDescription>{t('change.description')}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id={FORM_ID}
            noValidate
            onSubmit={(event) =>
              void form.handleSubmit((v) =>
                change.mutate(
                  { plan_id: v.plan_id, reason: v.reason.trim() },
                  {
                    onSuccess: () => {
                      onOpenChange(false);
                      toast.success(t('change.success'));
                    },
                  },
                ),
              )(event)
            }
            className="grid gap-4"
          >
            <FormField
              control={form.control}
              name="plan_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="change-plan">{t('change.plan')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger id="change-plan">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {active.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {t('change.planOption', {
                            name: p.name,
                            price: formatCurrency(p.unit_price_paisa, config),
                          })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="change-reason">{t('change.reason')}</FormLabel>
                  <FormControl>
                    <Textarea id="change-reason" rows={3} {...field} />
                  </FormControl>
                  <FormDescription>{t('change.nextOrder')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        {change.isError && (
          <p role="alert" className="text-caption text-destructive">
            {t('change.errors.generic')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={change.isPending}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="submit" form={FORM_ID} loading={change.isPending}>
            {t('change.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
