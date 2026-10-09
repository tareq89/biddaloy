import { describe, expect, it } from 'vitest';

import { DocumentKind } from '../enums/print';
import { FIELD_CATALOG } from './field-catalog';

describe('FIELD_CATALOG', () => {
  for (const kind of Object.values(DocumentKind)) {
    describe(kind, () => {
      const fields = FIELD_CATALOG[kind];

      it('has unique keys', () => {
        expect(new Set(fields.map((x) => x.key)).size).toBe(fields.length);
      });

      // ACR is confidential: it must have NO verify QR (the public verify page would expose the holder).
      it(
        kind === DocumentKind.ACR_ASSESSMENT
          ? 'has no verify QR'
          : 'has a print.verify_qr qr field',
        () => {
          const qr = fields.find((x) => x.key === 'print.verify_qr');
          if (kind === DocumentKind.ACR_ASSESSMENT) expect(qr).toBeUndefined();
          else expect(qr?.type).toBe('qr');
        },
      );

      it('gives every field a sample', () => {
        for (const x of fields) expect(x.sample, x.key).not.toBe('');
      });
    });
  }
});
