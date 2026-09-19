import { describe, it, expect } from 'vitest';
import * as invoicesDto from './invoices.dto';

/**
 * [16.8.2] `toFamilyInvoice`/`FamilyInvoiceDto` used to live in this file,
 * next to the staff invoice DTOs. Their behaviour is now tested in
 * `modules/fees/dto/family.dto.spec.ts`, which is where they moved.
 *
 * What stays here is the *structural* half of that ticket: the whole point
 * of consolidating was that "what can a guardian see?" must be answerable
 * from exactly one file. A second family mapper growing back here — added
 * in good faith next to the staff DTO it shadows — quietly undoes that,
 * and no behavioural test would notice. This one does.
 */
describe('invoices.dto no longer owns a family-facing shape', () => {
  it('exports no Family* DTO or toFamily* mapper', () => {
    const strays = Object.keys(invoicesDto).filter(
      (name) => name.startsWith('Family') || name.startsWith('toFamily'),
    );

    expect(strays).toEqual([]);
  });
});
