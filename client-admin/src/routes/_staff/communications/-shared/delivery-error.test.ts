import { describe, expect, it } from 'vitest';

import { deliveryErrorKey } from './delivery-error';

describe('deliveryErrorKey', () => {
  it('maps NOT_CONFIGURED', () => {
    expect(deliveryErrorKey('NOT_CONFIGURED')).toBe('deliveryErrors.notConfigured');
  });

  it('maps NO_PROVIDER', () => {
    expect(deliveryErrorKey('NO_PROVIDER')).toBe('deliveryErrors.noProvider');
  });

  it('falls back to the generic key for FAILED', () => {
    expect(deliveryErrorKey('FAILED')).toBe('deliveryErrors.generic');
  });

  it('returns null when there is no error', () => {
    expect(deliveryErrorKey(null)).toBeNull();
    expect(deliveryErrorKey('')).toBeNull();
  });
});
