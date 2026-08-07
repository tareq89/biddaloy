/**
 * Thrown by `TenantProviderConfigResolver` when neither a tenant setting
 * nor an env-var fallback resolves a medium's required fields. Each
 * provider (`WhatsAppCloudProvider`, `SmtpEmailProvider`,
 * `MessengerProvider`, `SmsProviderFactory`) catches this in its own
 * `send()` and converts it to `{ success: false, error: message }` —
 * `CommunicationProvider.send()`'s own contract is that a provider never
 * throws, so this error must never escape past the provider boundary.
 */
export class ProviderNotConfiguredError extends Error {
  constructor(medium: string, hint: string) {
    super(
      `${medium} is not configured for this tenant, and no platform-wide fallback is set. ${hint}`,
    );
    this.name = 'ProviderNotConfiguredError';
  }
}
