/**
 * #3887 New and edit a coupon (D23-D25). Percent 1-99 and fixed go through `useCreateCoupon`;
 * 100 percent goes through `useCreateFreeCoupon` and shows one of three states: made, waiting for
 * the other owner (D24), or cannot be made without a second owner (D29). Edit sends only what the
 * server lets change (end date, total uses, schools). Money is whole paisa; a failed save shows one
 * fixed sentence, never the server text (Rule 23). `Idempotency-Key` comes from the hooks (Rule 25).
 */
import { COUPON_CODE_PATTERN } from '@biddaloy/shared';
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
  Label,
  MoneyInput,
  MultiCombobox,
  RadioGroup,
  RadioGroupItem,
  toast,
} from '@biddaloy/ui/components';
import {
  useCreateCoupon,
  useCreateFreeCoupon,
  usePlatformSchoolList,
  useUpdateCoupon,
  type CreateCouponInput,
  type CreateFreeCouponInput,
  type PlatformCoupon,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, tenantTodayIso } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const FORM_ID = 'coupon-form';
/** Mirror the server's coupon.dto.ts bounds; the server constants are not shared. */
const FIXED_MAX_PAISA = 2_000_000_000;
const BIG_MAX_PAISA = 9_999_999_999;
const MAX_SCHOOLS = 500;

type Waiting = { requestId: string } | 'needs-second-owner' | null;

interface FormValues {
  code: string;
  kind: 'PERCENT' | 'FIXED';
  percent: string;
  fixedPaisa: number | undefined;
  months: string;
  maxDiscountPaisa: number | undefined;
  minOrderPaisa: number | undefined;
  scope: 'ALL' | 'SCHOOLS';
  schools: string[];
  maxUses: string;
  perSchool: string;
  startsAt: string;
  endsAt: string;
}

const blank = (today: string, coupon?: PlatformCoupon): FormValues =>
  coupon
    ? {
        code: coupon.code.toUpperCase(),
        kind: coupon.discount_kind,
        percent: coupon.percent === null ? '' : String(coupon.percent),
        fixedPaisa: coupon.fixed_paisa ?? undefined,
        months: coupon.max_months === null ? '' : String(coupon.max_months),
        maxDiscountPaisa:
          coupon.max_discount_paisa === null ? undefined : Number(coupon.max_discount_paisa),
        minOrderPaisa: coupon.min_order_paisa === null ? undefined : Number(coupon.min_order_paisa),
        scope: coupon.scope,
        schools: [],
        maxUses: coupon.max_uses === null ? '' : String(coupon.max_uses),
        perSchool: String(coupon.per_school_max),
        startsAt: coupon.starts_at.slice(0, 10),
        endsAt: coupon.ends_at.slice(0, 10),
      }
    : {
        code: '',
        kind: 'PERCENT',
        percent: '',
        fixedPaisa: undefined,
        months: '',
        maxDiscountPaisa: undefined,
        minOrderPaisa: undefined,
        scope: 'ALL',
        schools: [],
        maxUses: '',
        perSchool: '1',
        startsAt: today,
        endsAt: '',
      };

const whole = (s: string, min: number, max: number) =>
  /^\d+$/.test(s) && Number(s) >= min && Number(s) <= max;
const optWhole = (s: string, max: number) => s === '' || whole(s, 1, max);
const optMoney = (v: number | undefined, max: number) => v === undefined || (v > 0 && v <= max);

export interface CouponDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set for edit; absent for a new coupon. */
  coupon?: PlatformCoupon | undefined;
  /** Opens the approvals list (Epic 98) from the waiting card. */
  onOpenApprovals: () => void;
}

export function CouponDialog({ open, onOpenChange, coupon, onOpenApprovals }: CouponDialogProps) {
  const { t } = useTranslation('moneyCoupons');
  const config = useRegionConfig();
  const create = useCreateCoupon();
  const createFree = useCreateFreeCoupon();
  const update = useUpdateCoupon();
  const editing = coupon !== undefined;
  const [waiting, setWaiting] = React.useState<Waiting>(null);
  const [freeBody, setFreeBody] = React.useState<CreateFreeCouponInput | null>(null);
  // ponytail: first 100 schools by name, filtered in the box; a search-as-you-type picker if more.
  const schoolsQuery = usePlatformSchoolList({ limit: 100, sort: 'name' });
  const schoolOptions = (schoolsQuery.data?.items ?? []).map((s) => ({
    value: s.id,
    label: s.name,
  }));

  const schema = React.useMemo(() => {
    const money = (max: number) => t('dialog.errors.money', { max: formatCurrency(max, config) });
    return z
      .object({
        code: z.string().transform((s) => s.trim().toUpperCase()),
        kind: z.enum(['PERCENT', 'FIXED']),
        percent: z.string(),
        fixedPaisa: z.custom<number | undefined>(),
        months: z.string(),
        maxDiscountPaisa: z.custom<number | undefined>(),
        minOrderPaisa: z.custom<number | undefined>(),
        scope: z.enum(['ALL', 'SCHOOLS']),
        schools: z.array(z.string()),
        maxUses: z.string(),
        perSchool: z.string(),
        startsAt: z.string(),
        endsAt: z.string(),
      })
      .superRefine((v, ctx) => {
        const bad = (path: keyof FormValues, message: string) =>
          ctx.addIssue({ code: 'custom', path: [path], message });
        if (!editing) {
          if (!COUPON_CODE_PATTERN.test(v.code)) bad('code', t('dialog.errors.code'));
          if (v.kind === 'PERCENT' && !whole(v.percent, 1, 100))
            bad('percent', t('dialog.errors.percent'));
          if (
            v.kind === 'FIXED' &&
            (v.fixedPaisa === undefined || !optMoney(v.fixedPaisa, FIXED_MAX_PAISA))
          )
            bad(
              'fixedPaisa',
              t('dialog.errors.fixed', { max: formatCurrency(FIXED_MAX_PAISA, config) }),
            );
          if (!optWhole(v.months, 24)) bad('months', t('dialog.errors.count'));
          if (!optMoney(v.maxDiscountPaisa, BIG_MAX_PAISA))
            bad('maxDiscountPaisa', money(BIG_MAX_PAISA));
          if (!optMoney(v.minOrderPaisa, BIG_MAX_PAISA)) bad('minOrderPaisa', money(BIG_MAX_PAISA));
          if (!whole(v.perSchool, 1, 1000)) bad('perSchool', t('dialog.errors.count'));
          if (!v.startsAt) bad('startsAt', t('dialog.errors.dates'));
        }
        if (!optWhole(v.maxUses, 1_000_000)) bad('maxUses', t('dialog.errors.count'));
        if (!v.endsAt || (v.startsAt && v.endsAt <= v.startsAt))
          bad('endsAt', t('dialog.errors.dates'));
        // Edit keeps the old school list unless new schools are chosen.
        if (v.scope === 'SCHOOLS' && v.schools.length === 0 && !editing)
          bad('schools', t('dialog.errors.schools'));
      });
  }, [t, config, editing]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: blank(tenantTodayIso(config), coupon),
  });
  const kind = form.watch('kind');
  const scope = form.watch('scope');
  const isFree = !editing && kind === 'PERCENT' && form.watch('percent') === '100';

  React.useEffect(() => {
    if (open) {
      form.reset(blank(tenantTodayIso(config), coupon));
      create.reset();
      createFree.reset();
      update.reset();
      setWaiting(null);
      setFreeBody(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open, coupon?.id]);

  const saving = create.isPending || createFree.isPending || update.isPending;
  const failed = create.isError || createFree.isError || update.isError;

  const done = () => {
    onOpenChange(false);
    toast.success(t('dialog.saved'));
  };

  function sendFree(body: CreateFreeCouponInput, approvalId?: string) {
    createFree.mutate(approvalId ? { ...body, approvalId } : body, {
      onSuccess: (result) => {
        if (result.kind === 'created') done();
        else if (result.kind === 'waiting') setWaiting({ requestId: result.requestId });
        else setWaiting('needs-second-owner');
      },
    });
  }

  function handleSubmit(v: FormValues) {
    const ends_at = `${v.endsAt}T23:59:59.000Z`;
    const max_uses = v.maxUses === '' ? undefined : Number(v.maxUses);
    const schools = v.scope === 'SCHOOLS' && v.schools.length > 0 ? v.schools : undefined;
    if (coupon) {
      update.mutate(
        {
          id: coupon.id,
          ends_at,
          ...(max_uses !== undefined ? { max_uses } : {}),
          ...(schools ? { schools } : {}),
        },
        { onSuccess: done },
      );
      return;
    }
    const shared = {
      code: v.code,
      scope: v.scope,
      per_school_max: Number(v.perSchool),
      starts_at: `${v.startsAt}T00:00:00.000Z`,
      ends_at,
      ...(v.months !== '' ? { max_months: Number(v.months) } : {}),
      ...(v.minOrderPaisa !== undefined ? { min_order_paisa: v.minOrderPaisa } : {}),
      ...(max_uses !== undefined ? { max_uses } : {}),
      ...(v.scope === 'SCHOOLS' ? { schools: v.schools } : {}),
    };
    if (isFree) {
      setFreeBody(shared);
      sendFree(shared);
      return;
    }
    const body: CreateCouponInput = {
      ...shared,
      discount_kind: v.kind,
      ...(v.kind === 'PERCENT'
        ? { percent: Number(v.percent) }
        : { fixed_paisa: v.fixedPaisa ?? 0 }),
      ...(v.maxDiscountPaisa !== undefined ? { max_discount_paisa: v.maxDiscountPaisa } : {}),
    };
    create.mutate(body, { onSuccess: done });
  }

  const locked = editing;
  const waitingCard = typeof waiting === 'object' && waiting !== null ? waiting : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="lg" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>{editing ? t('dialog.editTitle') : t('dialog.newTitle')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>
        {editing && <p className="text-caption text-text-secondary">{t('dialog.editNote')}</p>}

        <Form {...form}>
          <form
            id={FORM_ID}
            noValidate
            onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
            className="grid gap-4"
          >
            <fieldset disabled={waiting !== null} className="contents">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="coupon-code">{t('dialog.code')}</FormLabel>
                    <FormControl>
                      <Input
                        id="coupon-code"
                        {...field}
                        disabled={locked}
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormDescription>{t('dialog.codeHelp')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('dialog.kind')}</FormLabel>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={locked}
                      className="flex gap-4"
                      aria-label={t('dialog.kind')}
                    >
                      {(['PERCENT', 'FIXED'] as const).map((k) => (
                        <span key={k} className="flex items-center gap-2">
                          <RadioGroupItem
                            value={k}
                            id={`coupon-kind-${k}`}
                            aria-label={t(
                              k === 'PERCENT' ? 'dialog.kindPercent' : 'dialog.kindFixed',
                            )}
                          />
                          <Label htmlFor={`coupon-kind-${k}`}>
                            {t(k === 'PERCENT' ? 'dialog.kindPercent' : 'dialog.kindFixed')}
                          </Label>
                        </span>
                      ))}
                    </RadioGroup>
                  </FormItem>
                )}
              />

              {kind === 'PERCENT' ? (
                <FormField
                  control={form.control}
                  name="percent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="coupon-percent">{t('dialog.percent')}</FormLabel>
                      <FormControl>
                        <Input
                          id="coupon-percent"
                          inputMode="numeric"
                          {...field}
                          disabled={locked}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <FormField
                  control={form.control}
                  name="fixedPaisa"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="coupon-fixed">{t('dialog.fixed')}</FormLabel>
                      <FormControl>
                        <MoneyInput
                          id="coupon-fixed"
                          config={config}
                          value={field.value}
                          onValueChange={field.onChange}
                          onBlur={field.onBlur}
                          disabled={locked}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {isFree && (
                <p
                  role="status"
                  className="rounded-md border border-border-subtle p-3 text-caption"
                >
                  {t('dialog.freeWarning')}
                </p>
              )}

              <FormField
                control={form.control}
                name="months"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="coupon-months">{t('dialog.months')}</FormLabel>
                    <FormControl>
                      <Input id="coupon-months" inputMode="numeric" {...field} disabled={locked} />
                    </FormControl>
                    <FormDescription>{t('dialog.monthsHelp')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {kind === 'PERCENT' && !isFree && (
                <FormField
                  control={form.control}
                  name="maxDiscountPaisa"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="coupon-max-discount">{t('dialog.maxDiscount')}</FormLabel>
                      <FormControl>
                        <MoneyInput
                          id="coupon-max-discount"
                          config={config}
                          value={field.value}
                          onValueChange={field.onChange}
                          onBlur={field.onBlur}
                          disabled={locked}
                        />
                      </FormControl>
                      <FormDescription>{t('dialog.optional')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="minOrderPaisa"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="coupon-min-order">{t('dialog.minOrder')}</FormLabel>
                    <FormControl>
                      <MoneyInput
                        id="coupon-min-order"
                        config={config}
                        value={field.value}
                        onValueChange={field.onChange}
                        onBlur={field.onBlur}
                        disabled={locked}
                      />
                    </FormControl>
                    <FormDescription>{t('dialog.optional')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="scope"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('dialog.who')}</FormLabel>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={locked}
                      className="flex gap-4"
                      aria-label={t('dialog.who')}
                    >
                      {(['ALL', 'SCHOOLS'] as const).map((s) => (
                        <span key={s} className="flex items-center gap-2">
                          <RadioGroupItem
                            value={s}
                            id={`coupon-scope-${s}`}
                            aria-label={t(s === 'ALL' ? 'dialog.whoAll' : 'dialog.whoSchools')}
                          />
                          <Label htmlFor={`coupon-scope-${s}`}>
                            {t(s === 'ALL' ? 'dialog.whoAll' : 'dialog.whoSchools')}
                          </Label>
                        </span>
                      ))}
                    </RadioGroup>
                  </FormItem>
                )}
              />

              {scope === 'SCHOOLS' && (
                <FormField
                  control={form.control}
                  name="schools"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('dialog.schools')}</FormLabel>
                      <MultiCombobox
                        aria-label={t('dialog.schools')}
                        placeholder={t('dialog.schoolsSearch')}
                        emptyText={t('dialog.schoolsEmpty')}
                        options={schoolOptions}
                        value={field.value}
                        onValueChange={field.onChange}
                        max={MAX_SCHOOLS}
                      />
                      {editing && <FormDescription>{t('dialog.schoolsKeep')}</FormDescription>}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="maxUses"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="coupon-max-uses">{t('dialog.maxUses')}</FormLabel>
                    <FormControl>
                      <Input id="coupon-max-uses" inputMode="numeric" {...field} />
                    </FormControl>
                    <FormDescription>{t('dialog.optional')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="perSchool"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="coupon-per-school">{t('dialog.perSchool')}</FormLabel>
                    <FormControl>
                      <Input
                        id="coupon-per-school"
                        inputMode="numeric"
                        {...field}
                        disabled={locked}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="startsAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="coupon-starts">{t('dialog.starts')}</FormLabel>
                    <FormControl>
                      <Input id="coupon-starts" type="date" {...field} disabled={locked} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endsAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="coupon-ends">{t('dialog.ends')}</FormLabel>
                    <FormControl>
                      <Input id="coupon-ends" type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </fieldset>
          </form>
        </Form>

        {waitingCard && (
          <div
            role="status"
            className="flex flex-col gap-3 rounded-lg border border-border-subtle p-4"
          >
            <p className="font-semibold">{t('waiting.title')}</p>
            <p>{t('waiting.text')}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={onOpenApprovals}>
                {t('waiting.open')}
              </Button>
              <Button
                type="button"
                loading={createFree.isPending}
                onClick={() => freeBody && sendFree(freeBody, waitingCard.requestId)}
              >
                {t('waiting.again')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setWaiting(null);
                  setFreeBody(null);
                }}
              >
                {t('waiting.startOver')}
              </Button>
            </div>
          </div>
        )}
        {waiting === 'needs-second-owner' && (
          <div role="status" className="rounded-lg border border-border-subtle p-4">
            <p className="font-semibold">{t('needsOwner.title')}</p>
            <p>{t('needsOwner.text')}</p>
          </div>
        )}
        {failed && (
          <p role="alert" className="text-caption text-destructive">
            {t('dialog.errors.generic')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={saving}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="submit" form={FORM_ID} loading={saving} disabled={waiting !== null}>
            {isFree ? t('dialog.saveFree') : t('dialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
