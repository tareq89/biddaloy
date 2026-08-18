import { describe, it, expect } from 'vitest';

import { buildFormShellErrors } from './form-shell-errors';

describe('buildFormShellErrors', () => {
  it('maps a flat field error to the prefixed id', () => {
    const errors = { accessToken: { type: 'required', message: 'Required' } };

    const result = buildFormShellErrors(errors, (field) => `whatsapp-${field}`);

    expect(result).toEqual([{ field: 'whatsapp-accessToken', message: 'Required' }]);
  });

  it('walks a nested field group into a dotted path', () => {
    const errors = {
      currency: { code: { type: 'min', message: 'Too short' } },
    };

    const result = buildFormShellErrors(errors, (field) => `regional-${field.replace(/\./g, '-')}`);

    expect(result).toEqual([{ field: 'regional-currency-code', message: 'Too short' }]);
  });

  it('does not recurse into react-hook-form metadata keys', () => {
    // A real FieldError carries ref/type/types alongside message — ref in
    // particular is a DOM element; recursing into it should never happen.
    const errors = {
      host: { type: 'required', types: { required: true }, ref: {}, message: 'Required' },
    };

    const result = buildFormShellErrors(errors, (field) => `email-${field}`);

    expect(result).toEqual([{ field: 'email-host', message: 'Required' }]);
  });

  it('supports an explicit non-pattern id map, for fields whose id does not follow field-name alone', () => {
    const errors = {
      greenwebApiUrl: { type: 'invalid', message: 'Invalid URL' },
      mimsmsSenderId: { type: 'required', message: 'Required' },
    };
    const idByField: Record<string, string> = {
      greenwebApiUrl: 'sms-greenweb-apiUrl',
      mimsmsSenderId: 'sms-mimsms-senderId',
    };

    const result = buildFormShellErrors(errors, (field) => idByField[field] ?? `sms-${field}`);

    expect(result).toEqual(
      expect.arrayContaining([
        { field: 'sms-greenweb-apiUrl', message: 'Invalid URL' },
        { field: 'sms-mimsms-senderId', message: 'Required' },
      ]),
    );
  });

  it('handles multiple top-level fields and multiple nested groups', () => {
    const errors = {
      locale: { type: 'min', message: 'Required' },
      currency: {
        code: { type: 'min', message: 'Required' },
        symbol: { type: 'min', message: 'Required' },
      },
    };

    const result = buildFormShellErrors(errors, (field) => `regional-${field.replace(/\./g, '-')}`);

    expect(result).toEqual(
      expect.arrayContaining([
        { field: 'regional-locale', message: 'Required' },
        { field: 'regional-currency-code', message: 'Required' },
        { field: 'regional-currency-symbol', message: 'Required' },
      ]),
    );
    expect(result).toHaveLength(3);
  });

  it('returns an empty array when there are no errors', () => {
    expect(buildFormShellErrors({}, (field) => field)).toEqual([]);
  });
});
