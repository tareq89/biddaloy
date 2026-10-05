import { describe, expect, it } from 'vitest';

import { deliveryErrorKey } from './delivery-error';

describe('deliveryErrorKey', () => {
  it('maps the provider-not-configured sentence', () => {
    expect(
      deliveryErrorKey(
        "SMS (Greenweb) is not configured for this tenant, and no platform-wide fallback is set. Configure it on this school's settings, or set GREENWEB_API_KEY as a platform-wide fallback.",
      ),
    ).toBe('deliveryErrors.notConfigured');
  });

  it('maps the no-provider sentence', () => {
    expect(deliveryErrorKey('No provider registered for medium "SMS"')).toBe(
      'deliveryErrors.noProvider',
    );
  });

  it('falls back to the generic key for any other text', () => {
    expect(deliveryErrorKey('ECONNRESET')).toBe('deliveryErrors.generic');
  });

  it('returns null when there is no error', () => {
    expect(deliveryErrorKey(null)).toBeNull();
    expect(deliveryErrorKey('')).toBeNull();
  });
});
