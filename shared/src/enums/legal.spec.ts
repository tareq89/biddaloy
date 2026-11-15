import { describe, expect, it } from 'vitest';
import {
  ADMIN_REQUIRED_DOCS,
  LEGAL_DOCS,
  LegalDocument,
  PhotoConsent,
} from './legal';

describe('legal enums', () => {
  it('every document has a x.y version', () => {
    for (const doc of Object.values(LegalDocument)) {
      expect(LEGAL_DOCS[doc].version).toMatch(/^\d+\.\d+$/);
    }
  });
  it('admin required docs are legal documents', () => {
    for (const doc of ADMIN_REQUIRED_DOCS) {
      expect(Object.values(LegalDocument)).toContain(doc);
    }
  });
  it('PhotoConsent has exactly 3 values', () => {
    expect(Object.values(PhotoConsent)).toHaveLength(3);
  });
});
