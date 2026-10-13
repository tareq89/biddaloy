import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { assertXlsxWithinLimits, XlsxTooLargeError } from './xlsx-guard.util';

async function workbookWith(cellText: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Sheet1').getCell('A1').value = cellText;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('assertXlsxWithinLimits', () => {
  it('rejects an xlsx whose entries inflate past the budget', async () => {
    // 2 MB of "A" deflates to a few KB: small upload, big once inflated.
    const bomb = await workbookWith('A'.repeat(2 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(100 * 1024);

    expect(() => assertXlsxWithinLimits(bomb, { maxUncompressedBytes: 1024 * 1024 })).toThrow(
      XlsxTooLargeError,
    );
  });

  it('passes a normal small workbook under the default caps', async () => {
    const buf = await workbookWith('hello');
    expect(() => assertXlsxWithinLimits(buf)).not.toThrow();
  });

  it('passes a large-but-legitimate workbook (many rows) under the default caps', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    for (let i = 0; i < 20_000; i++) ws.addRow([`student ${i}`, i, 'Class One', 'A']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    expect(() => assertXlsxWithinLimits(buf)).not.toThrow();
  });

  it('rejects too many entries', async () => {
    const buf = await workbookWith('x');
    expect(() => assertXlsxWithinLimits(buf, { maxEntries: 2 })).toThrow(XlsxTooLargeError);
  });

  it('does not trust a forged uncompressed size in the central directory', async () => {
    const buf = await workbookWith('A'.repeat(2 * 1024 * 1024));
    // Central-directory entries start with PK\x01\x02; the uncompressed size is at +24.
    for (let i = 0; i < buf.length - 4; i++) {
      if (buf.readUInt32LE(i) === 0x02014b50) buf.writeUInt32LE(10, i + 24);
    }

    expect(() => assertXlsxWithinLimits(buf, { maxUncompressedBytes: 1024 * 1024 })).toThrow(
      XlsxTooLargeError,
    );
  });

  it('throws on bytes that are not a zip', () => {
    expect(() => assertXlsxWithinLimits(Buffer.from('hello'))).toThrow();
  });

  it('counts a stored (method 0) entry by its size', () => {
    // Hand-built zip: one stored entry "a" holding 10 bytes.
    const name = Buffer.from('a');
    const body = Buffer.alloc(10, 1);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(name.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(body.length, 24);
    cen.writeUInt16LE(name.length, 28);
    const cenOffset = local.length + name.length + body.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cenOffset, 16);
    const zip = Buffer.concat([local, name, body, cen, name, eocd]);

    expect(() => assertXlsxWithinLimits(zip, { maxUncompressedBytes: 10 })).not.toThrow();
    expect(() => assertXlsxWithinLimits(zip, { maxUncompressedBytes: 9 })).toThrow(
      XlsxTooLargeError,
    );
  });
});
