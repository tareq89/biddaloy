import { LEGAL_DOCS, LegalDocument } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { getLegalDoc } from './legal-docs';

const CASES = Object.values(LegalDocument).flatMap((d) =>
  (['bn', 'en'] as const).map((l) => [d, l] as const),
);

describe('legal docs', () => {
  it.each(CASES)('%s/%s exists and its version matches LEGAL_DOCS', (doc, lang) => {
    const { version, body } = getLegalDoc(doc, lang);
    expect(body.trim().length).toBeGreaterThan(0);
    expect(version).toBe(LEGAL_DOCS[doc].version);
  });
});
