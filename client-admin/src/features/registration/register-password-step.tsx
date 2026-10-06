/** Step 3: the first password. "Not now" only when the server said the account can go without one. */
import { SetPasswordForm, type SignInFormError } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface RegisterPasswordStepProps {
  onSubmit: (password: string) => void;
  /** Present only when the verify result says `password_required: false`. */
  onSkip?: () => void;
  loading?: boolean;
  error?: SignInFormError | null;
}

export function RegisterPasswordStep({
  onSubmit,
  onSkip,
  loading,
  error,
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
      {...(onSkip ? { onSkip } : {})}
      {...(loading !== undefined ? { loading } : {})}
      {...(error !== undefined ? { error } : {})}
    />
  );
}
