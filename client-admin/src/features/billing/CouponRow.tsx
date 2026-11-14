import { COUPON_CODE_PATTERN } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { Button, Input, Label } from '@biddaloy/ui/components';
import { useOrderPreview, type OrderPreviewResponse } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface AppliedCoupon {
  /** Upper-cased, exactly what is sent with the order. */
  code: string;
  preview: OrderPreviewResponse;
}

export interface CouponRowProps {
  /** `null` while the seats or months box holds something invalid: Apply stays off. */
  seats: number | null;
  months: number | null;
  /** The server turned the code down on submit: show the sentence again. */
  rejected?: boolean | undefined;
  /** Open on first render (`?coupon=1`). */
  defaultOpen?: boolean | undefined;
  onApplied: (applied: AppliedCoupon | null) => void;
}

/**
 * [100.4.03] "Have a coupon?" — collapsed by default. The discount depends on seats and months, so
 * changing either clears the result. One sentence for every failure (D23): never says why.
 */
export function CouponRow({ seats, months, rejected, defaultOpen, onApplied }: CouponRowProps) {
  const { t } = useTranslation('billing');
  const [open, setOpen] = React.useState(defaultOpen ?? false);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<'invalid' | 'tryLater' | null>(null);
  const [applied, setApplied] = React.useState<AppliedCoupon | null>(null);
  const preview = useOrderPreview();
  const onAppliedRef = React.useRef(onApplied);
  onAppliedRef.current = onApplied;

  // Seats or months changed: the old discount no longer fits.
  React.useEffect(() => {
    setApplied(null);
    setError(null);
    preview.reset();
    onAppliedRef.current(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the numbers change
  }, [seats, months]);

  React.useEffect(() => {
    if (rejected) {
      setOpen(true);
      setApplied(null);
    }
  }, [rejected]);

  function apply() {
    const upper = code.trim().toUpperCase();
    setApplied(null);
    onApplied(null);
    if (seats === null || months === null) return;
    // Not shaped like a code (letters, digits, dash; bn digits too): the same sentence, no request.
    if (!COUPON_CODE_PATTERN.test(upper)) {
      setError('invalid');
      return;
    }
    setError(null);
    preview.mutate(
      { seats, months, coupon_code: upper },
      {
        onSuccess: (result) => {
          const next = { code: upper, preview: result };
          setApplied(next);
          onApplied(next);
        },
        onError: (err) =>
          setError(
            err instanceof ApiError &&
              (err.statusCode === 429 || err.details?.['code'] === 'COUPON_TRY_LATER')
              ? 'tryLater'
              : 'invalid',
          ),
      },
    );
  }

  const sentence = error ?? (rejected && !applied ? 'invalid' : null);

  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="link"
        className="h-auto justify-start p-0"
        aria-expanded={open}
        aria-controls="coupon-panel"
        onClick={() => setOpen((o) => !o)}
      >
        {t('coupon.toggle')}
      </Button>
      {open && (
        <div id="coupon-panel" className="grid gap-2">
          <Label htmlFor="coupon-code">{t('coupon.code')}</Label>
          <div className="flex gap-2">
            <Input
              id="coupon-code"
              value={code}
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setApplied(null);
                setError(null);
                onApplied(null);
              }}
              onKeyDown={(e) => {
                // Enter applies the code; it must not submit the whole order.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (!preview.isPending && code.trim()) apply();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              loading={preview.isPending}
              disabled={code.trim() === '' || seats === null || months === null}
              onClick={apply}
            >
              {t('coupon.apply')}
            </Button>
          </div>
          {sentence && (
            <p role="alert" className="text-sm text-destructive">
              {t(sentence === 'tryLater' ? 'coupon.tryLater' : 'coupon.invalid')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
