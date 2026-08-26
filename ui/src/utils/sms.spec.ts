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

  it('counts the ASCII GSM-7 extension characters ({}[]~^|\\) double', () => {
    const result = countSmsSegments('Tk 50 {}');
    expect(result.encoding).toBe('GSM_7');
    // 'T','k',' ','5','0',' ' = 6 septets, '{' and '}' = 4 septets.
    expect(result.chars).toBe(10);
  });

  it('159 plain characters plus an extension char tips into a second segment', () => {
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

  // The finding this file exists to lock down. `é` is a legitimate GSM-7
  // character under 3GPP TS 23.038, but the server's `isUnicodeMessage` is
  // a bare `/[^\x00-\x7F]/` test and GreenWeb/MIM then bill the message as
  // unicode at 70 characters per segment. Counting it as GSM-7 said
  // "1 segment"; the school is invoiced for 3.
  it('a single Latin-1 accent bills as UCS-2, matching the server, not TS 23.038', () => {
    const result = countSmsSegments(`${'a'.repeat(149)}é`);
    expect(result.encoding).toBe('UCS_2');
    expect(result.chars).toBe(150);
    // 150 code units / 67 per concatenated segment = 3.
    expect(result.segments).toBe(3);
    expect(result.perSegment).toBe(67);
  });

  it.each(['£', 'é', 'Ä', 'ñ', 'à', 'ø', 'Ç', '§', '€'])(
    'treats the non-ASCII GSM-7 character %s as UCS-2',
    (char) => {
      expect(countSmsSegments(`Dues ${char}`).encoding).toBe('UCS_2');
    },
  );

  it('counts an emoji as two UCS-2 characters (surrogate pair)', () => {
    const result = countSmsSegments('👍');
    expect(result).toMatchObject({ encoding: 'UCS_2', chars: 2, segments: 1 });
  });

  it('135 UCS-2 code units (2 × 67 + 1) needs three segments', () => {
    expect(countSmsSegments('ক'.repeat(135)).segments).toBe(3);
  });
});
