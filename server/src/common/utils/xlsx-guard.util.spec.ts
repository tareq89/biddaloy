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

    await expect(
      assertXlsxWithinLimits(bomb, { maxUncompressedBytes: 1024 * 1024 }),
    ).rejects.toThrow(XlsxTooLargeError);
  });

  it('passes a normal small workbook under the default caps', async () => {
    const buf = await workbookWith('hello');
    await expect(assertXlsxWithinLimits(buf)).resolves.toBeUndefined();
  });

  it('passes a large-but-legitimate workbook (many rows) under the default caps', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    for (let i = 0; i < 20_000; i++) ws.addRow([`student ${i}`, i, 'Class One', 'A']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    await expect(assertXlsxWithinLimits(buf)).resolves.toBeUndefined();
  });

  it('rejects too many entries', async () => {
    const buf = await workbookWith('x');
    await expect(assertXlsxWithinLimits(buf, { maxEntries: 2 })).rejects.toThrow(XlsxTooLargeError);
  });

  it('does not trust a forged uncompressed size in the central directory', async () => {
    const buf = await workbookWith('A'.repeat(2 * 1024 * 1024));
    // Central-directory entries start with PK\x01\x02; the uncompressed size is at +24.
    for (let i = 0; i < buf.length - 4; i++) {
      if (buf.readUInt32LE(i) === 0x02014b50) buf.writeUInt32LE(10, i + 24);
    }

    await expect(
      assertXlsxWithinLimits(buf, { maxUncompressedBytes: 1024 * 1024 }),
    ).rejects.toThrow(XlsxTooLargeError);
  });

  it('throws on bytes that are not a zip', async () => {
    await expect(assertXlsxWithinLimits(Buffer.from('hello'))).rejects.toThrow();
  });

  it('counts a stored (method 0) entry by its size', async () => {
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
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cen.length + name.length, 12);
    eocd.writeUInt32LE(cenOffset, 16);
    const zip = Buffer.concat([local, name, body, cen, name, eocd]);

    await expect(
      assertXlsxWithinLimits(zip, { maxUncompressedBytes: 10 }),
    ).resolves.toBeUndefined();
    await expect(assertXlsxWithinLimits(zip, { maxUncompressedBytes: 9 })).rejects.toThrow(
      XlsxTooLargeError,
    );
  });

  // Regression: jszip (inside exceljs) reads the EOCD more leniently than a
  // naive walker. Each case below LOADS fine in real exceljs yet must be refused.
  describe('crafted zips that exceljs would still load', () => {
    const lim = { maxUncompressedBytes: 1024 * 1024 };
    const big = () => workbookWith('A'.repeat(8 * 1024 * 1024));
    const eocdAt = (b: Buffer) => b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    async function exceljsCellLength(b: Buffer): Promise<number> {
      const w = new ExcelJS.Workbook();
      await w.xlsx.load(b as never);
      return String(w.worksheets[0].getCell('A1').value).length;
    }

    it('rejects an EOCD entry count of 0 (jszip ignores the count)', async () => {
      const b = await big();
      const e = eocdAt(b);
      b.writeUInt16LE(0, e + 8);
      b.writeUInt16LE(0, e + 10);

      expect(await exceljsCellLength(b)).toBe(8 * 1024 * 1024);
      await expect(assertXlsxWithinLimits(b, lim)).rejects.toThrow();
    });

    it('rejects decoy data prepended so that the directory offsets shift', async () => {
      const good = await big();
      const e = eocdAt(good);
      const n = good.readUInt16LE(e + 10);
      const oB = good.readUInt32LE(e + 16);
      const name = Buffer.from('a');
      const loc = Buffer.alloc(30);
      loc.writeUInt32LE(0x04034b50, 0);
      loc.writeUInt16LE(1, 26);
      const cen = Buffer.alloc(46);
      cen.writeUInt32LE(0x02014b50, 0);
      cen.writeUInt32LE(1, 20);
      cen.writeUInt32LE(1, 24);
      cen.writeUInt16LE(1, 28);
      const head = Buffer.concat([loc, name, Buffer.from([0x41])]);
      const prefix = Buffer.concat([
        head,
        Buffer.alloc(oB - head.length),
        ...Array(n).fill(Buffer.concat([cen, name])),
      ]);
      const file = Buffer.concat([prefix, good]);

      expect(await exceljsCellLength(file)).toBe(8 * 1024 * 1024);
      await expect(assertXlsxWithinLimits(file, lim)).rejects.toThrow();
    });

    it('rejects a zip64-sentinel field in the EOCD', async () => {
      const b = await big();
      b.writeUInt16LE(0xffff, eocdAt(b) + 4);

      // jszip would go looking for a zip64 record here (and a forged one could
      // redirect it), so the guard refuses the sentinel outright.
      await expect(assertXlsxWithinLimits(b, lim)).rejects.toThrow(XlsxTooLargeError);
    });

    it('rejects directory entries that all point at the same compressed bytes', async () => {
      // Two central-directory records share one 200-byte stored body: their
      // compressed sizes add up past the file, so the bytes are reused.
      const name = Buffer.from('a');
      const body = Buffer.alloc(200, 1);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(name.length, 26);
      const cen = Buffer.alloc(46);
      cen.writeUInt32LE(0x02014b50, 0);
      cen.writeUInt32LE(body.length, 20);
      cen.writeUInt32LE(body.length, 24);
      cen.writeUInt16LE(name.length, 28);
      const cenOffset = local.length + name.length + body.length;
      const cenRec = Buffer.concat([cen, name]);
      const records = [cenRec, cenRec];
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(records.length, 8);
      eocd.writeUInt16LE(records.length, 10);
      eocd.writeUInt32LE(cenRec.length * records.length, 12);
      eocd.writeUInt32LE(cenOffset, 16);
      const zip = Buffer.concat([local, name, body, ...records, eocd]);

      await expect(assertXlsxWithinLimits(zip)).rejects.toThrow('Bad zip layout');
    });
  });
});
