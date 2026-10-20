/**
 * Server delivery error code → `communications` i18n key, so a failed delivery
 * never shows server text (D9). The server sends a fixed code, never the raw
 * worker/provider text (Rule 23; `server/src/modules/communications/delivery-error-code.ts`).
 */
export function deliveryErrorKey(error: string | null | undefined): string | null {
  if (!error) return null;
  if (error === 'NOT_CONFIGURED') return 'deliveryErrors.notConfigured';
  if (error === 'NO_PROVIDER') return 'deliveryErrors.noProvider';
  return 'deliveryErrors.generic';
}
