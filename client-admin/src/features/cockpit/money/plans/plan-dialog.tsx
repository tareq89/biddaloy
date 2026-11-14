/**
 * #3886 New and edit a plan (D26). Both are `useApprovedMutation`s (step-up scope `platform.plan`).
 * Price is a `MoneyInput` in whole paisa and goes out as whole paisa. A failed save shows one fixed
 * sentence, never the server text (Rule 23). `Idempotency-Key` comes from `useCreatePlan`.
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
  Input,
  MoneyInput,
  toast,
} from '@biddaloy/ui/components';
import { useCreatePlan, useUpdatePlan, type PlatformPlan } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const FORM_ID = 'plan-form';
/** Mirrors the server's `PLAN_PRICE_MAX_PAISA` (plan.dto.ts); the server constant is not shared. */
const PLAN_PRICE_MAX_PAISA = 100_000_000;

interface FormValues {
  name: string;
  pricePaisa: number | undefined;
}

const blank = (plan?: PlatformPlan): FormValues =>
  plan
    ? { name: plan.name, pricePaisa: plan.unit_price_paisa }
    : { name: '', pricePaisa: undefined };

export interface PlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set for edit; absent for a new plan. */
  plan?: PlatformPlan | undefined;
}

export function PlanDialog({ open, onOpenChange, plan }: PlanDialogProps) {
  const { t } = useTranslation('moneyPlans');
  const config = useRegionConfig();
  const create = useCreatePlan();
  const update = useUpdatePlan();
  const save = plan ? update : create;

  const schema = React.useMemo(
    () =>
      z.object({
        name: z.string().trim().min(2, t('dialog.errors.name')).max(60, t('dialog.errors.name')),
        pricePaisa: z
          .custom<number | undefined>()
          .refine((v) => v !== undefined && v > 0 && v <= PLAN_PRICE_MAX_PAISA, {
            message: t('dialog.errors.price', {
              max: formatCurrency(PLAN_PRICE_MAX_PAISA, config),
            }),
          }),
      }),
    [t, config],
  );
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: blank(plan) });

  React.useEffect(() => {
    if (open) {
      form.reset(blank(plan));
      create.reset();
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open, plan?.id]);

  function handleSubmit(values: FormValues) {
    const body = { name: values.name.trim(), unit_price_paisa: values.pricePaisa ?? 0 };
    const onSuccess = () => {
      onOpenChange(false);
      toast.success(t('dialog.saved'));
    };
    if (plan) update.mutate({ id: plan.id, ...body }, { onSuccess });
    else create.mutate(body, { onSuccess });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && save.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="md" showCloseButton={!save.isPending}>
        <DialogHeader>
          <DialogTitle>{plan ? t('dialog.editTitle') : t('dialog.newTitle')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id={FORM_ID}
            noValidate
            onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
            className="grid gap-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="plan-name">{t('dialog.name')}</FormLabel>
                  <FormControl>
                    <Input id="plan-name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="pricePaisa"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="plan-price">{t('dialog.price')}</FormLabel>
                  <FormControl>
                    <MoneyInput
                      id="plan-price"
                      config={config}
                      value={field.value}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  </FormControl>
                  <FormDescription>{t('dialog.nextOrder')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        {save.isError && (
          <p role="alert" className="text-caption text-destructive">
            {t('dialog.errors.generic')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={save.isPending}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="submit" form={FORM_ID} loading={save.isPending}>
            {t('dialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
