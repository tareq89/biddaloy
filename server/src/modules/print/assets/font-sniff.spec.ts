import { describe, it, expect } from 'vitest';
import { sniffFont } from './font-sniff';

const withTail = (head: Buffer) => Buffer.concat([head, Buffer.alloc(16)]);

describe('sniffFont', () => {
  it('accepts the four magic headers', () => {
    expect(sniffFont(withTail(Buffer.from([0, 1, 0, 0])))).toBe('ttf');
    expect(sniffFont(withTail(Buffer.from('true', 'latin1')))).toBe('ttf');
    expect(sniffFont(withTail(Buffer.from('OTTO', 'latin1')))).toBe('otf');
    expect(sniffFont(withTail(Buffer.from('wOF2', 'latin1')))).toBe('woff2');
  });

  it('rejects a PNG, random bytes and an empty buffer', () => {
    expect(sniffFont(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(sniffFont(Buffer.from('not a font at all'))).toBeNull();
    expect(sniffFont(Buffer.alloc(0))).toBeNull();
  });
});
