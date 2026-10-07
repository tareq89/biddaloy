/**
 * Worker error text → `communications` i18n key, so a failed delivery never
 * shows the server's English sentence (D9). The texts come from
 * `server/src/modules/communications/config/provider-not-configured.error.ts`
 * and `worker/communications.processor.ts`.
 *
 * ponytail: string matching on English server text; switch to an `error_code`
 * lookup when the server sends one (shared request filed).
 */
export function deliveryErrorKey(error: string | null): string | null {
  if (error === null || error === '') return null;
  if (/is not configured for this tenant/i.test(error)) return 'deliveryErrors.notConfigured';
  if (/^No provider registered/i.test(error)) return 'deliveryErrors.noProvider';
  return 'deliveryErrors.generic';
}
