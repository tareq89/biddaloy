import { ImportFileErrorCode } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { importFileErrorKey } from './import-file-error';

describe('importFileErrorKey', () => {
  it.each([
    [ImportFileErrorCode.UNREADABLE, 'unreadable'],
    [ImportFileErrorCode.UNSUPPORTED_TYPE, 'unsupportedType'],
    [ImportFileErrorCode.MISSING_COLUMNS, 'missingColumns'],
    [ImportFileErrorCode.TOO_MANY_ROWS, 'tooManyRows'],
    [ImportFileErrorCode.NO_ROWS, 'noRows'],
    [ImportFileErrorCode.TOO_LARGE, 'tooLarge'],
  ])('maps %s to %s', (code, key) => {
    expect(importFileErrorKey({ details: { code } })).toBe(key);
  });

  it.each([[undefined], [null], [{}], [{ details: {} }], [{ details: { code: 'NOPE' } }], ['x']])(
    'is undefined for %j',
    (error) => {
      expect(importFileErrorKey(error)).toBeUndefined();
    },
  );

  it('ignores inherited keys such as constructor', () => {
    expect(importFileErrorKey({ details: { code: 'constructor' } })).toBeUndefined();
  });
});
