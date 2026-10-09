import * as React from 'react';

/**
 * The printer a person last used, remembered per device and per school (D21).
 * The browser can't tell which printer its print dialog uses, so we remember the
 * one the user chose here. Every access is wrapped: private mode and blocked
 * storage throw, and "no remembered printer" is a fine answer.
 */
export const rememberedPrinterKey = (tenantId: string) => `print.printer.${tenantId}`;

export function readRememberedPrinter(tenantId: string): string | null {
  try {
    return window.localStorage.getItem(rememberedPrinterKey(tenantId));
  } catch {
    return null;
  }
}

export function useRememberedPrinter(
  tenantId: string,
): [string | null, (printerId: string) => void] {
  const [printerId, setPrinterId] = React.useState<string | null>(() =>
    readRememberedPrinter(tenantId),
  );

  const remember = React.useCallback(
    (next: string) => {
      setPrinterId(next);
      try {
        window.localStorage.setItem(rememberedPrinterKey(tenantId), next);
      } catch {
        // Not remembered next time; still works for this session.
      }
    },
    [tenantId],
  );

  return [printerId, remember];
}
