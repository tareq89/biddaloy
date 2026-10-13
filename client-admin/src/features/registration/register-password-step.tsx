/** Step 3: the first password. "Not now" only when the server said the account can go without one. */
import type { PasswordRuleId } from '@biddaloy/shared';
import { SetPasswordForm, type SignInFormError } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface RegisterPasswordStepProps {
  onSubmit: (password: string) => void;
  /** Present only when the verify result says `password_required: false`. */
  onSkip?: () => void;
  loading?: boolean;
  error?: SignInFormError | null;
  /** Rules the server said the last submitted password broke. */
  failedRules?: PasswordRuleId[] | undefined;
  /** The server refused the last submitted password as over 72 bytes. */
  tooLong?: boolean | undefined;
}

export function RegisterPasswordStep({
  onSubmit,
  onSkip,
  loading,
  error,
  failedRules,
  tooLong,
}: RegisterPasswordStepProps) {
  const { t } = useTranslation('register');
  return (
    <SetPasswordForm
      heading={t('password.title')}
      subtext={t('password.subtitle')}
      audience="staff"
      submitLabel={t('password.save')}
      skipLabel={t('password.skip')}
      onSubmit={onSubmit}
      failedRules={failedRules}
      tooLong={tooLong}
      {...(onSkip ? { onSkip } : {})}
      {...(loading !== undefined ? { loading } : {})}
      {...(error !== undefined ? { error } : {})}
    />
  );
}
