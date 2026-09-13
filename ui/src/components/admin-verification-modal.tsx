/**
 * [16.2.4] The step-up modal `useApprovedMutation` (`ui/src/hooks/
 * approval.ts`) opens whenever a mutation comes back `APPROVAL_REQUIRED`.
 * Presentational only, same split every other form in this package
 * documents (see `contact-change-dialog.tsx`'s own comment): the hook owns
 * the two network calls (`onRequestOtp`/`onVerify`), this component owns
 * the fields, the method toggle, the resend timer and inline error text.
 *
 * Method toggle: OTP is always available and is the default; Password is
 * only rendered when `passwordAllowed` is true. That flag is derived by
 * the caller from the school's auth settings — `AuthSettingsDto`
 * (`server/src/modules/schools/dto/tenant-settings.dto.ts`) doesn't carry
 * the password-step-up-allowed field yet (only `otpLoginEnabled`, landing
 * separately under D9), so this component takes the resolved boolean
 * directly rather than querying settings itself — a caller wires
 * `passwordAllowed={settings.fees?.approval_mode === 'OTP_OR_PASSWORD'}`
 * once that field exists server-side, and tests/stories here pass the
 * boolean straight through, per the plan's "mock the settings query
 * response shape" note.
 *
 * `scope` is a machine key (e.g. `fees.duplicate_create`); `SCOPE_LABELS`
 * maps known scopes to a human sentence ("Approve: create a duplicate
 * fee"), falling back to `approval.scopeFallback` for a scope this
 * component doesn't know about yet — new call sites don't need a modal
 * change to work, just an i18n key if they want a nicer label.
 */
import * as React from 'react';

import { useTranslation } from '../i18n';

import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Input } from './input';
import { OtpInput } from './otp-input';
import { RadioGroup, RadioGroupItem } from './radio';

export type ApprovalMethod = 'otp' | 'password';

export interface ApprovalResult {
  approval_token: string;
  approver: { id: string; name: string };
}

/** Duck-typed against the server's error envelope
 * (`ui/src/api/errors.ts`'s `ApiErrorBody.details`) rather than a specific
 * class, same reasoning as that file's own `isTenantSuspendedError`. */
export interface AdminVerificationError {
  code?: string;
  message: string;
}

export interface AdminVerificationModalProps {
  open: boolean;
  /** Machine key for the action being approved — see `SCOPE_LABELS` below. */
  scope: string;
  /** Whether the school's auth settings allow password as a step-up
   * method for this admin — see this file's own doc comment. Defaults to
   * `false` (OTP-only) so a caller that hasn't wired the setting yet gets
   * the safe default rather than an unexpectedly-available password field. */
  passwordAllowed?: boolean;
  onRequestOtp: (identifier: string) => Promise<void>;
  onVerify: (input: {
    identifier: string;
    method: ApprovalMethod;
    code?: string;
    password?: string;
  }) => Promise<ApprovalResult>;
  onSuccess: (result: ApprovalResult) => void;
  onCancel: () => void;
  loading?: boolean;
  requestingOtp?: boolean;
  error?: AdminVerificationError | null;
}

const RESEND_COOLDOWN_SECONDS = 60;

const SCOPE_LABEL_KEYS: Record<string, string> = {
  'fees.duplicate_create': 'scopes.fees.duplicate_create',
  'fees.waiver_apply': 'scopes.fees.waiver_apply',
  'payments.refund_issue': 'scopes.payments.refund_issue',
  'invoices.void': 'scopes.invoices.void',
};

export function AdminVerificationModal({
  open,
  scope,
  passwordAllowed = false,
  onRequestOtp,
  onVerify,
  onSuccess,
  onCancel,
  loading = false,
  requestingOtp = false,
  error = null,
}: AdminVerificationModalProps) {
  const { t } = useTranslation('approval');
  const [method, setMethod] = React.useState<ApprovalMethod>('otp');
  const [identifier, setIdentifier] = React.useState('');
  const [code, setCode] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [codeSent, setCodeSent] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    setMethod('otp');
    setIdentifier('');
    setCode('');
    setPassword('');
    setCodeSent(false);
    setSecondsLeft(0);
  }, [open]);

  React.useEffect(() => {
    if (secondsLeft <= 0) return;
    const interval = setInterval(() => setSecondsLeft((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(interval);
  }, [secondsLeft]);

  const scopeLabel = SCOPE_LABEL_KEYS[scope] ? t(SCOPE_LABEL_KEYS[scope]) : t('scopeFallback', { scope });

  const errorMessage = React.useMemo(() => {
    if (!error) return null;
    if (error.code === 'PASSWORD_NOT_ALLOWED') return t('errors.passwordNotAllowed');
    if (error.code === 'RATE_LIMITED') return t('errors.rateLimited');
    if (error.code === 'INVALID_CODE') return t('errors.invalidCode');
    return error.message || t('errors.generic');
  }, [error, t]);

  async function handleSendCode() {
    try {
      await onRequestOtp(identifier);
      setCodeSent(true);
      setSecondsLeft(RESEND_COOLDOWN_SECONDS);
    } catch {
      // The caller maps this onto its own `error` prop (rate-limited, etc.)
      // and re-renders with it — same reasoning as `contact-change-dialog
      // .tsx`'s own catches — nothing further to do here.
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await onVerify(
        method === 'otp' ? { identifier, method, code } : { identifier, method, password },
      );
      onSuccess(result);
    } catch {
      // Same reasoning as handleSendCode's catch above.
    }
  }

  const canSubmit =
    identifier.trim().length > 0 &&
    (method === 'otp' ? codeSent && code.length === 6 : password.length > 0);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{scopeLabel}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="admin-verification-identifier" className="text-sm font-medium">
              {t('identifierLabel')}
            </label>
            <Input
              id="admin-verification-identifier"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="off"
              required
            />
          </div>

          {passwordAllowed && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-sm font-medium">{t('methodLabel')}</legend>
              <RadioGroup
                value={method}
                onValueChange={(value) => setMethod(value as ApprovalMethod)}
                className="flex gap-4"
              >
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="otp" id="admin-verification-method-otp" />
                  {t('methodOtp')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="password" id="admin-verification-method-password" />
                  {t('methodPassword')}
                </label>
              </RadioGroup>
            </fieldset>
          )}

          {method === 'otp' ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="admin-verification-code" className="text-sm font-medium">
                {t('otp.codeLabel')}
              </label>
              <div className="flex gap-2">
                <OtpInput
                  id="admin-verification-code"
                  aria-label={t('otp.codeLabel')}
                  value={code}
                  onValueChange={setCode}
                  disabled={loading}
                />
                <Button
                  type="button"
                  variant="outline"
                  loading={requestingOtp}
                  disabled={!identifier.trim() || secondsLeft > 0 || requestingOtp}
                  onClick={() => void handleSendCode()}
                >
                  {secondsLeft > 0
                    ? t('otp.resendIn', { count: secondsLeft })
                    : codeSent
                      ? t('otp.resend')
                      : t('otp.sendCode')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="admin-verification-password" className="text-sm font-medium">
                {t('passwordLabel')}
              </label>
              <Input
                id="admin-verification-password"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
          )}

          {errorMessage && (
            <p id="admin-verification-error" role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              loading={loading}
              disabled={!canSubmit || loading}
              aria-describedby={errorMessage ? 'admin-verification-error' : undefined}
            >
              {loading ? t('submitting') : t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
