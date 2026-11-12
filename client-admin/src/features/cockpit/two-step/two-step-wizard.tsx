import { ApiError, RateLimitedError, setAccessToken } from '@biddaloy/ui/api';
import {
  AuthenticatorSetupCard,
  Button,
  Card,
  CodeField,
  RecoveryCodesCard,
} from '@biddaloy/ui/components';
import { useCockpitEnrolConfirm } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, StepIndicator } from '@biddaloy/ui/shells';
import * as React from 'react';

import type { EnrolHandoff } from '../sign-in/enrol-handoff';

/** Mirror of `COCKPIT_STEP_REFUSED` in `server/.../cockpit-step-token.ts` (pinned by the wizard test). */
const STEP_REFUSED = 'Sign-in failed. Please start again.';

/** True on a phone-width screen; the QR cannot be scanned by the phone that shows it. */
function useIsPhone(): boolean {
  const query = '(max-width: 767px)';
  const [phone, setPhone] = React.useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
  );
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setPhone(list.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, []);
  return phone;
}

export interface TwoStepWizardProps {
  /** Read once from sessionStorage by the route. `null`: show "start again". */
  handoff: EnrolHandoff | null;
  /** The owner finished (codes saved) or closed after the codes were shown. */
  onDone: () => void;
  /** The hand-off is missing or the owner left before confirming: back to `/sign-in`. */
  onStartAgain: () => void;
}

/**
 * [98.4.04] `/owner-security/two-step`, mockup section b. Step 1 adds the authenticator (the card
 * already sent SMS and email codes at sign-in; this only does enrol/confirm), step 2 shows the
 * recovery codes once. Codes live in component state only: never stored, never logged.
 */
export function TwoStepWizard({ handoff, onDone, onStartAgain }: TwoStepWizardProps) {
  const { t } = useTranslation('ownerSecurity');
  const confirm = useCockpitEnrolConfirm();
  const phone = useIsPhone();
  const [code, setCode] = React.useState('');
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const steps = [
    { id: 'add', label: t('wizard.step1') },
    { id: 'codes', label: t('wizard.step2') },
  ];
  const current = codes ? 'codes' : 'add';

  // The server answers a bad hand-off token with its "start again" sentence and a wrong code with
  // its "check your details" one, both 401 (`cockpit-step-token.ts`): only the first ends the wizard.
  const expired =
    confirm.error instanceof ApiError &&
    (confirm.error.statusCode === 410 ||
      (confirm.error.statusCode === 401 && confirm.error.message === STEP_REFUSED));

  if (!handoff || expired) {
    return (
      <FullPageShell
        title={t('wizard.title')}
        closeLabel={t('wizard.close')}
        onClose={onStartAgain}
      >
        <Card padded className="flex flex-col gap-3">
          <h2 className="text-h2">{t('wizard.startAgainTitle')}</h2>
          <p className="text-text-secondary">{t('wizard.startAgainBody')}</p>
          <Button className="min-h-11 self-start" onClick={onStartAgain}>
            {t('wizard.startAgain')}
          </Button>
        </Card>
      </FullPageShell>
    );
  }

  const error = confirm.error
    ? confirm.error instanceof RateLimitedError ||
      (confirm.error instanceof ApiError && confirm.error.statusCode === 429)
      ? t('wizard.slowDown')
      : confirm.error instanceof ApiError &&
          (confirm.error.statusCode === 400 || confirm.error.statusCode === 401)
        ? t('wizard.wrongCode')
        : t('wizard.generic')
    : undefined;

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (code.length !== 6 || !handoff) return;
    confirm.mutate(
      { enrolToken: handoff.enrolToken, code, rememberDevice: handoff.rememberDevice },
      {
        onSuccess: (result) => {
          setAccessToken(result.access_token);
          setCodes(result.recoveryCodes);
        },
      },
    );
  }

  async function copyKey(): Promise<void> {
    try {
      await navigator.clipboard.writeText(handoff?.secret ?? '');
      setCopied(true);
    } catch {
      // Clipboard blocked: the key stays visible to type by hand.
    }
  }

  const codeForm = (
    <>
      <CodeField
        id="owner-enrol-code"
        label={t('wizard.codeLabel')}
        hint={t('wizard.codeHint')}
        value={code}
        onValueChange={setCode}
        {...(error ? { error } : {})}
      />
      <Button
        type="submit"
        className="min-h-11 w-full"
        disabled={confirm.isPending || code.length !== 6}
      >
        {confirm.isPending ? t('wizard.working') : t('wizard.next')}
      </Button>
    </>
  );

  return (
    <FullPageShell
      title={t('wizard.title')}
      closeLabel={t('wizard.close')}
      onClose={codes ? onDone : onStartAgain}
      dirty={codes !== null && !saved}
      {...(codes
        ? {
            primary: {
              label: t('wizard.finish'),
              onClick: onDone,
              disabled: !saved,
            },
          }
        : {})}
    >
      <p className="text-sm text-text-secondary">
        {t('wizard.stepCount', { current: codes ? 2 : 1, total: 2 })}
      </p>
      <StepIndicator
        steps={steps}
        currentStepId={current}
        label={t('wizard.stepsLabel')}
        doneLabel={t('wizard.stepsDone')}
      />
      {codes ? (
        <>
          <RecoveryCodesCard
            codes={codes}
            onAcknowledged={setSaved}
            labels={{
              title: t('recoveryCodes.title'),
              description: t('recoveryCodes.description'),
              copy: t('recoveryCodes.copy'),
              copied: t('recoveryCodes.copied'),
              download: t('recoveryCodes.download'),
              acknowledge: t('recoveryCodes.acknowledge'),
            }}
          />
          {!saved && <p className="text-sm text-text-secondary">{t('wizard.ackNeeded')}</p>}
        </>
      ) : phone ? (
        <Card padded>
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <div>
              <h2 className="text-h2 text-balance">{t('authenticator.title')}</h2>
              <p className="mt-0.5 text-text-secondary">{t('authenticator.descriptionPhone')}</p>
            </div>
            <Button asChild className="min-h-11 w-full">
              <a href={handoff.otpauthUri}>{t('authenticator.openApp')}</a>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full"
              onClick={() => void copyKey()}
            >
              {copied ? t('authenticator.keyCopied') : t('authenticator.copyKey')}
            </Button>
            <code dir="ltr" className="block rounded-md bg-muted p-2 font-mono text-sm break-all">
              {handoff.secret}
            </code>
            {codeForm}
          </form>
        </Card>
      ) : (
        <AuthenticatorSetupCard
          otpauthUri={handoff.otpauthUri}
          manualKey={handoff.secret}
          labels={{
            title: t('authenticator.title'),
            description: t('authenticator.descriptionDesktop'),
            qrAlt: t('authenticator.qrAlt'),
            manualKeyLabel: t('authenticator.manualKey'),
            qrError: t('authenticator.qrError'),
          }}
        >
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            {codeForm}
          </form>
        </AuthenticatorSetupCard>
      )}
    </FullPageShell>
  );
}
