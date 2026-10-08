import { describe, expect, it } from 'vitest';

import {
  ACR_CRITERIA_SLOTS,
  ADMIT_CARD_SITTING_SLOTS,
  CERTIFICATE_SERIAL_CODE,
  CR80,
  DocumentKind,
  DuplexOrder,
  ImageFit,
  LayoutKind,
  OverflowPolicy,
  PRINT_BATCH_CEILING,
  PRINT_DEFAULT_BATCH_SIZE,
  PrintContextType,
  SERIAL_PREFIX_PATTERN,
  STUDENT_CERTIFICATE_KINDS,
  formatSerial,
  isSerialKind,
  isStudentCertificateKind,
  PrintAssetKind,
  PrintElementType,
  PrintItemOutcome,
  PrintJobStatus,
  PrintSubjectType,
  PrinterType,
  ShapeKind,
} from './print';

describe('print enums', () => {
  it('have stable string values', () => {
    expect(Object.values(DocumentKind)).toEqual([
      'STUDENT_ID_CARD',
      'STAFF_ID_CARD',
      'ACR_ASSESSMENT',
      'EXAM_ADMIT_CARD',
      'TRANSFER_CERTIFICATE',
      'TESTIMONIAL',
      'CHARACTER_CERTIFICATE',
      'STUDY_CERTIFICATE',
      'PARTICIPATION_CERTIFICATE',
      'RESULT_CERTIFICATE',
      'MERIT_CERTIFICATE',
    ]);
    expect(Object.values(PrintContextType)).toEqual(['EXAM']);
    expect(Object.values(LayoutKind)).toEqual(['FIXED', 'FLOWING']);
    expect(Object.values(PrintElementType)).toEqual(['TEXT', 'IMAGE', 'QR', 'SHAPE']);
    expect(Object.values(ShapeKind)).toEqual(['RECT', 'LINE']);
    expect(Object.values(OverflowPolicy)).toEqual(['SHRINK', 'WRAP', 'CLIP', 'FLAG']);
    expect(Object.values(ImageFit)).toEqual(['COVER', 'CONTAIN']);
    expect(Object.values(PrinterType)).toEqual(['CARD', 'OFFICE']);
    expect(Object.values(DuplexOrder)).toEqual(['INTERLEAVED', 'GROUPED']);
    expect(Object.values(PrintAssetKind)).toEqual(['ARTWORK', 'IMAGE', 'FONT']);
    expect(Object.values(PrintJobStatus)).toEqual(['OPEN', 'CONFIRMED']);
    expect(Object.values(PrintItemOutcome)).toEqual(['PENDING', 'OK', 'FAILED']);
    expect(Object.values(PrintSubjectType)).toEqual(['STUDENT', 'STAFF', 'ACR']);
  });

  it('pins the batch limits and CR80 size', () => {
    expect(PRINT_BATCH_CEILING).toBe(200);
    expect(PRINT_DEFAULT_BATCH_SIZE).toBe(50);
    expect(ACR_CRITERIA_SLOTS).toBe(30);
    expect(ADMIT_CARD_SITTING_SLOTS).toBe(15);
    expect(CR80).toEqual({ widthMm: 85.6, heightMm: 54 });
  });

  describe('serials [48.1.01]', () => {
    it('formats with and without a prefix', () => {
      const a = { year: 2026 };
      expect(formatSerial({ ...a, kind: DocumentKind.TESTIMONIAL, n: 9 })).toBe('TSM-2026-00009');
      expect(
        formatSerial({ ...a, prefix: 'DAHS', kind: DocumentKind.TRANSFER_CERTIFICATE, n: 7 }),
      ).toBe('DAHS-TC-2026-00007');
    });

    it('throws for bad n and for a non-serial kind', () => {
      const ok = { year: 2026, kind: DocumentKind.TESTIMONIAL };
      expect(() => formatSerial({ ...ok, n: 0 })).toThrow(RangeError);
      expect(() => formatSerial({ ...ok, n: 100000 })).toThrow(RangeError);
      expect(() => formatSerial({ year: 2026, kind: DocumentKind.EXAM_ADMIT_CARD, n: 1 })).toThrow(
        RangeError,
      );
      expect(() => formatSerial({ ...ok, n: 1, prefix: 'da-hs' })).toThrow(RangeError);
      expect(() => formatSerial({ ...ok, n: 1, year: 26 })).toThrow(RangeError);
    });

    it('has a code for every serial kind and none for the admit card', () => {
      expect(Object.keys(CERTIFICATE_SERIAL_CODE)).toHaveLength(7);
      expect(isSerialKind(DocumentKind.MERIT_CERTIFICATE)).toBe(true);
      expect(isSerialKind(DocumentKind.EXAM_ADMIT_CARD)).toBe(false);
      expect(isSerialKind('toString' as DocumentKind)).toBe(false);
    });

    // D6: result/merit are exam documents, they stay on DOCUMENT_PRINT.
    it('keeps result and merit out of the CERTIFICATE_ISSUE kinds', () => {
      expect(STUDENT_CERTIFICATE_KINDS).not.toContain(DocumentKind.RESULT_CERTIFICATE);
      expect(isStudentCertificateKind(DocumentKind.MERIT_CERTIFICATE)).toBe(false);
      expect(isStudentCertificateKind(DocumentKind.TESTIMONIAL)).toBe(true);
    });

    it('validates the serial prefix', () => {
      expect(SERIAL_PREFIX_PATTERN.test('DAHS')).toBe(true);
      for (const bad of ['da', 'A', 'TOOLONGXX'])
        expect(SERIAL_PREFIX_PATTERN.test(bad)).toBe(false);
    });
  });
});
