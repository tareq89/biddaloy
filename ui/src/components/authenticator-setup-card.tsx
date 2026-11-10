/**
 * Authenticator-app enrolment card: a QR code drawn from the `otpauth://` URI,
 * the manual key as a fallback, and a slot for the confirm-code field.
 * Presentational: strings are props, the URI is never logged or stored, and
 * the QR is rendered as an inline SVG in the browser (no network call).
 */
import { toString as qrToString } from 'qrcode';
import * as React from 'react';

import { Card } from './card';

export interface AuthenticatorSetupCardLabels {
  title: string;
  /** Step text: scan this, then enter the code. */
  description: string;
  /** `aria-label` of the QR image. */
  qrAlt: string;
  /** Text above the manual key. */
  manualKeyLabel: string;
  /** Shown when the QR could not be drawn; the manual key is still usable. */
  qrError: string;
}

export interface AuthenticatorSetupCardProps {
  /** Full `otpauth://totp/...` URI. */
  otpauthUri: string;
  /** Base32 secret for typing by hand. */
  manualKey: string;
  labels: AuthenticatorSetupCardLabels;
  /** The confirm-code field (a `CodeField`) goes here. */
  children?: React.ReactNode;
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

export function AuthenticatorSetupCard({
  otpauthUri,
  manualKey,
  labels,
  children,
  headingLevel: Heading = 'h2',
  className,
}: AuthenticatorSetupCardProps) {
  const [qr, setQr] = React.useState<{ uri: string; svg: string | null } | null>(null);

  React.useEffect(() => {
    let live = true;
    qrToString(otpauthUri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(
      (svg) => live && setQr({ uri: otpauthUri, svg }),
      () => live && setQr({ uri: otpauthUri, svg: null }),
    );
    return () => {
      live = false;
    };
  }, [otpauthUri]);

  const settled = qr?.uri === otpauthUri ? qr : null;

  return (
    <Card padded className={className}>
      <div className="flex flex-col gap-4">
        <div>
          <Heading className="text-h2 text-balance">{labels.title}</Heading>
          <p className="mt-0.5 text-text-secondary">{labels.description}</p>
        </div>

        <div className="flex justify-center">
          {settled?.svg ? (
            <div
              role="img"
              aria-label={labels.qrAlt}
              className="size-44 rounded-md bg-white p-1 [&>svg]:size-full"
              dangerouslySetInnerHTML={{ __html: settled.svg }}
            />
          ) : settled ? (
            <p role="alert" className="text-caption text-destructive">
              {labels.qrError}
            </p>
          ) : (
            <div className="size-44 animate-pulse rounded-md bg-muted" aria-hidden="true" />
          )}
        </div>

        <div>
          <p className="text-sm text-text-secondary">{labels.manualKeyLabel}</p>
          <code
            dir="ltr"
            className="mt-1 block rounded-md bg-muted p-2 font-mono text-sm break-all"
          >
            {manualKey}
          </code>
        </div>

        {children}
      </div>
    </Card>
  );
}
