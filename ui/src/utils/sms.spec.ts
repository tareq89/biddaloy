import { describe, expect, it } from 'vitest';

import { countSmsSegments } from './sms';

describe('countSmsSegments', () => {
  it('reports an empty message as zero segments, not one', () => {
    expect(countSmsSegments('')).toEqual({
      encoding: 'GSM_7',
      chars: 0,
      segments: 0,
      perSegment: 160,
    });
  });

  it('counts plain English as GSM-7, one segment up to 160 characters', () => {
    const result = countSmsSegments('Dear guardian, fees are due.');
    expect(result.encoding).toBe('GSM_7');
    expect(result.chars).toBe(28);
    expect(result.segments).toBe(1);
    expect(result.perSegment).toBe(160);
  });

  it('exactly 160 GSM-7 characters is still one segment', () => {
    const result = countSmsSegments('a'.repeat(160));
    expect(result.segments).toBe(1);
    expect(result.perSegment).toBe(160);
  });

  it('161 GSM-7 characters concatenates at 153 per segment', () => {
    const result = countSmsSegments('a'.repeat(161));
    expect(result.segments).toBe(2);
    expect(result.perSegment).toBe(153);
  });

  it('307 GSM-7 characters (2 × 153 + 1) needs three segments', () => {
    expect(countSmsSegments('a'.repeat(307)).segments).toBe(3);
  });

  it('counts GSM-7 extension characters ({}[]~^€|\\) double', () => {
    // 5 plain + 2 extension characters = 5 + 2×2 = 9 septets.
    const result = countSmsSegments('Tk 50 {}');
    expect(result.encoding).toBe('GSM_7');
    // 'T','k',' ','5','0',' ' = 6 septets, '{' and '}' = 4 septets.
    expect(result.chars).toBe(10);
  });

  it('80 characters ending in an extension char tips into a second segment', () => {
    // 159 plain septets + '{' (2 septets) = 161 septets → 2 segments.
    const result = countSmsSegments(`${'a'.repeat(159)}{`);
    expect(result.encoding).toBe('GSM_7');
    expect(result.chars).toBe(161);
    expect(result.segments).toBe(2);
  });

  it('treats Bangla text as UCS-2 with a 70-character single segment', () => {
    const bangla = 'প্রিয় অভিভাবক, আপনার সন্তানের ফি বকেয়া আছে।';
    const result = countSmsSegments(bangla);
    expect(result.encoding).toBe('UCS_2');
    expect(result.chars).toBe(bangla.length);
    expect(result.segments).toBe(1);
    expect(result.perSegment).toBe(70);
  });

  it('exactly 70 UCS-2 characters is one segment; 71 concatenates at 67', () => {
    const seventy = 'ক'.repeat(70);
    expect(countSmsSegments(seventy)).toMatchObject({
      encoding: 'UCS_2',
      segments: 1,
      perSegment: 70,
    });
    const seventyOne = 'ক'.repeat(71);
    expect(countSmsSegments(seventyOne)).toMatchObject({
      encoding: 'UCS_2',
      chars: 71,
      segments: 2,
      perSegment: 67,
    });
  });

  it('one Bangla character in an English message forces the whole message to UCS-2', () => {
    const result = countSmsSegments(`${'a'.repeat(100)}ক`);
    expect(result.encoding).toBe('UCS_2');
    // 101 code units > 70 → concatenated.
    expect(result.segments).toBe(2);
  });

  it('counts an emoji as two UCS-2 characters (surrogate pair)', () => {
    const result = countSmsSegments('👍');
    expect(result).toMatchObject({ encoding: 'UCS_2', chars: 2, segments: 1 });
  });

  it('135 UCS-2 code units (2 × 67 + 1) needs three segments', () => {
    expect(countSmsSegments('ক'.repeat(135)).segments).toBe(3);
  });
});
