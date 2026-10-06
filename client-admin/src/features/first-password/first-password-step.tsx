import { audienceForRoles, type UserRole } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { SetPasswordForm, weakPasswordRules, type SignInFormError } from '@biddaloy/ui/components';
import { setFirstPassword } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useMutation } from '@tanstack/react-query';

export interface FirstPasswordStepProps {
  /** Every role the account holds; decides which password rules apply. */
  roles: UserRole[];
  /** When true there is no way past this step except setting a password. */
  passwordRequired: boolean;
  /** Called after the password is saved (or skipped, or already existed). */
  onDone: () => void;
}

/**
 * The "add a password" card shown right after a first code sign-in
 * (`needs_password`). Staff must set one (`passwordRequired`); everyone else
 * may skip.
 */
export function FirstPasswordStep({ roles, passwordRequired, onDone }: FirstPasswordStepProps) {
  const { t } = useTranslation('auth');
  const mutation = useMutation({
    mutationFn: setFirstPassword,
    onSuccess: onDone,
    // 409: a password already exists (another tab set it) — nothing left to do.
    onError: (error) => {
      if (error instanceof ApiError && error.statusCode === 409) onDone();
    },
  });

  const error: SignInFormError | null =
    mutation.error && !weakPasswordRules(mutation.error)
      ? { message: t('errors.generic'), tone: 'alert' }
      : null;

  return (
    <SetPasswordForm
      heading={t('firstPassword.heading')}
      subtext={t('firstPassword.subtext')}
      audience={audienceForRoles(roles)}
      onSubmit={(password) => mutation.mutate(password)}
      loading={mutation.isPending}
      error={error}
      failedRules={weakPasswordRules(mutation.error)}
      submitLabel={t('setPassword.submit')}
      {...(passwordRequired ? {} : { onSkip: onDone, skipLabel: t('setPassword.skip') })}
    />
  );
}
