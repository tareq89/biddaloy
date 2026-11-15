import { countCsvRecordSeparators } from './spreadsheet-loader.util';

const count = (s: string) => countCsvRecordSeparators(Buffer.from(s), 1_000_000);

describe('countCsvRecordSeparators', () => {
  it('counts LF, CR-only and CRLF (once) separators', () => {
    expect(count('a\nb\nc\n')).toBe(3);
    expect(count('a\rb\rc\r')).toBe(3);
    expect(count('a\r\nb\r\nc')).toBe(2);
    expect(count('a\rb\nc\r\nd')).toBe(3);
  });

  it('ignores newlines inside quoted fields, including escaped quotes', () => {
    expect(count('h,description\n1,"line1\nline2"\n2,"say ""hi""\nbye"\n')).toBe(3);
    expect(count('1,"a\rb"\r2,"c"\r')).toBe(2);
  });

  it('treats a quote that does not start a field as plain data (no hiding separators)', () => {
    expect(count('a"b\nc"d\ne\n')).toBe(3);
  });

  it('stops once the cap is reached', () => {
    expect(countCsvRecordSeparators(Buffer.from('a\n'.repeat(50)), 5)).toBe(5);
  });
});
