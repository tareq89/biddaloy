import { describe, expect, it } from 'vitest';

import {
  CR80,
  DocumentKind,
  DuplexOrder,
  ImageFit,
  LayoutKind,
  OverflowPolicy,
  PRINT_BATCH_CEILING,
  PRINT_DEFAULT_BATCH_SIZE,
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
    expect(Object.values(DocumentKind)).toEqual(['STUDENT_ID_CARD', 'STAFF_ID_CARD']);
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
    expect(Object.values(PrintSubjectType)).toEqual(['STUDENT', 'STAFF']);
  });

  it('pins the batch limits and CR80 size', () => {
    expect(PRINT_BATCH_CEILING).toBe(200);
    expect(PRINT_DEFAULT_BATCH_SIZE).toBe(50);
    expect(CR80).toEqual({ widthMm: 85.6, heightMm: 54 });
  });
});
