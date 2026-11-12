import { RateLimitedError, setAccessToken } from '@biddaloy/ui/api';
import { NoticeBar } from '@biddaloy/ui/components';
import {
  useCockpitDeviceOtp,
  useCockpitEnrolStart,
  useCockpitLogin,
  useCockpitMfa,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { CodeStep } from './code-step';
import { DeviceStep } from './device-step';
import { clearEnrolHandoff, saveEnrolHandoff } from './enrol-handoff';
import { PasswordStep } from './password-step';

type Step =
  | { name: 'password' }
  | { name: 'code'; mfaToken: string }
  | { name: 'device'; deviceToken: string }
  | { name: 'enrol'; enrolToken: string };

export interface CockpitSignInCardProps {
  /** Signed in: the route goes to the `redirect` page or the owner's home. */
  onSignedIn: () => void;
  /** Codes passed on a first set-up: the route goes to `/owner-security/two-step`. */
  onEnrol: () => void;
  /** Shown above the card once, e.g. after a password reset. */
  notice?: string | undefined;
  /** The "Forgot your password?" link, a router `<Link>` from the route. */
  forgotAction?: React.ReactNode;
}

/**
 * [98.4.03] The owner sign-in card. One component, the step changes in place (D13). Mockup:
 * `docs/ux-research/cockpit-identity-mockups.md` section a. Every failure before both proofs
 * pass shows the same sentence (Rule 18); the server answers alike, so the card never says
 * which part was wrong.
 */
export function CockpitSignInCard({
  onSignedIn,
  onEnrol,
  notice,
  forgotAction,
}: CockpitSignInCardProps) {
  const { t } = useTranslation('cockpit');
  const [step, setStep] = React.useState<Step>({ name: 'password' });
  const login = useCockpitLogin();
  const mfa = useCockpitMfa();
  const device = useCockpitDeviceOtp();
  const enrol = useCockpitEnrolStart();

  function toStep(result: { step: string; [k: string]: unknown }): void {
    if (result.step === 'mfa') setStep({ name: 'code', mfaToken: result.mfaToken as string });
    else if (result.step === 'device')
      setStep({ name: 'device', deviceToken: result.deviceToken as string });
    else if (result.step === 'enrol')
      setStep({ name: 'enrol', enrolToken: result.enrolToken as string });
    else if (result.step === 'done') {
      setAccessToken(result.access_token as string);
      onSignedIn();
    }
  }

  function again(): void {
    clearEnrolHandoff();
    login.reset();
    mfa.reset();
    device.reset();
    enrol.reset();
    setStep({ name: 'password' });
  }

  const rate = (e: unknown) => (e instanceof RateLimitedError ? t('signIn.errors.slowDown') : null);
  const err = (e: unknown, fallback: string) => (e ? (rate(e) ?? fallback) : undefined);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('signIn.title')}</h1>
      {notice && step.name === 'password' && <NoticeBar tone="info">{notice}</NoticeBar>}
      {step.name === 'password' && (
        <PasswordStep
          secondaryAction={forgotAction}
          loading={login.isPending}
          error={err(login.error, t('signIn.errors.generic'))}
          onSubmit={(identity, password) =>
            login.mutate({ ...identity, password }, { onSuccess: toStep })
          }
        />
      )}
      {step.name === 'code' && (
        <CodeStep
          loading={mfa.isPending}
          error={err(mfa.error, t('signIn.errors.wrongCode'))}
          onStartAgain={again}
          onSubmit={(code) => mfa.mutate({ mfaToken: step.mfaToken, code }, { onSuccess: toStep })}
        />
      )}
      {step.name === 'device' && (
        <DeviceStep
          mode="device"
          loading={device.isPending}
          error={err(device.error, t('signIn.errors.wrongDeviceCode'))}
          onStartAgain={again}
          onSubmit={(codes) =>
            device.mutate({ deviceToken: step.deviceToken, ...codes }, { onSuccess: toStep })
          }
        />
      )}
      {step.name === 'enrol' && (
        <DeviceStep
          mode="enrol"
          loading={enrol.isPending}
          error={err(enrol.error, t('signIn.errors.wrongDeviceCode'))}
          onStartAgain={again}
          onSubmit={({ smsCode, emailCode, rememberDevice }) =>
            enrol.mutate(
              { enrolToken: step.enrolToken, smsCode, emailCode },
              {
                onSuccess: (r) => {
                  saveEnrolHandoff({
                    enrolToken: step.enrolToken,
                    otpauthUri: r.otpauthUri,
                    secret: r.secret,
                    rememberDevice,
                  });
                  onEnrol();
                },
              },
            )
          }
        />
      )}
    </div>
  );
}
