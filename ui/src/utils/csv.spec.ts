import { describe, expect, it } from 'vitest';

import { csvCell, toCsvContent } from './csv';

describe('csvCell', () => {
  it('quotes the value and doubles embedded quotes', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('renders null/undefined as an empty cell, not "null"/"undefined"', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it('guards CSV injection: formula-leading characters get a quote prefix', () => {
    // `=HYPERLINK(...)` in a cell would execute on open in Excel/Sheets.
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell('+8801712345678')).toBe('"\'+8801712345678"');
    expect(csvCell('-5')).toBe('"\'-5"');
    expect(csvCell('@handle')).toBe('"\'@handle"');
    expect(csvCell('\tindent')).toBe('"\'\tindent"');
  });

  it('preserves Bangla text unchanged', () => {
    expect(csvCell('আরিফা খাতুন')).toBe('"আরিফা খাতুন"');
  });
});

describe('toCsvContent', () => {
  it('prefixes the UTF-8 BOM so Excel decodes Bangla correctly', () => {
    const csv = toCsvContent([['a']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('joins cells with commas and rows with CRLF', () => {
    const csv = toCsvContent([
      ['row', 'reason'],
      [2, 'bad phone'],
    ]);
    expect(csv).toBe('\uFEFF"row","reason"\r\n"2","bad phone"');
  });
});
