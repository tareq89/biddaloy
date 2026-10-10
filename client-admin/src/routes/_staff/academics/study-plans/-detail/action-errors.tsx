import { ApiError } from '@biddaloy/ui/api';
import type * as React from 'react';

/** The server's machine code on an error (`details.code`); never the message. */
export function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const code = error.details?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Inline, announced error under a dialog's fields. */
export function DialogError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}
