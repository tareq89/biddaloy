import { inflateRawSync } from 'node:zlib';

export class XlsxTooLargeError extends Error {}

export interface XlsxLimits {
  maxUncompressedBytes?: number;
  maxEntries?: number;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/**
 * Refuses a zip bomb before exceljs loads it. Walks the central directory and
 * actually inflates every entry against a running byte budget — the sizes
 * declared in the headers are never trusted, so a forged header is harmless.
 * Throws `XlsxTooLargeError` (or a plain Error for malformed zips); callers
 * put it first inside the `try` whose `catch` already maps to their
 * "could not read file" error.
 *
 * ponytail: inflates each entry once just to measure (2x CPU on a valid
 * file, bounded by the caps); exceljs streaming reader if upload volume ever
 * makes that matter.
 */
export function assertXlsxWithinLimits(
  buf: Buffer,
  { maxUncompressedBytes = 100 * 1024 * 1024, maxEntries = 5_000 }: XlsxLimits = {},
): void {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  // jszip (inside exceljs) is lenient about the EOCD, so every field it could
  // read differently from us must be pinned down, or a crafted zip can pass
  // this check yet inflate more when exceljs loads it.
  const u16 = (o: number) => buf.readUInt16LE(eocd + o);
  const count = u16(10);
  const cenSize = buf.readUInt32LE(eocd + 12);
  let p = buf.readUInt32LE(eocd + 16);
  if (
    [u16(4), u16(6), u16(8), count].includes(0xffff) ||
    cenSize === 0xffffffff ||
    p === 0xffffffff
  ) {
    throw new XlsxTooLargeError('zip64 not accepted');
  }
  if (u16(4) !== 0 || u16(6) !== 0 || u16(8) !== count) throw new Error('Multi-disk zip');
  if (p + cenSize !== eocd || eocd + 22 + u16(20) !== buf.length) throw new Error('Bad zip layout');
  if (count > maxEntries) throw new XlsxTooLargeError('Too many entries in archive');

  let total = 0;
  let compTotal = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG)
      throw new Error('Bad zip directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    // Entries pointing at the same bytes would multiply inflate work per upload.
    compTotal += compSize;
    if (compTotal > buf.length) throw new Error('Bad zip layout');
    const local = buf.readUInt32LE(p + 42);
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);

    if (local + 30 > buf.length || buf.readUInt32LE(local) !== LOC_SIG)
      throw new Error('Bad zip entry');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compSize);
    if (method === 0) {
      total += data.length;
    } else if (method === 8) {
      try {
        total += inflateRawSync(data, { maxOutputLength: maxUncompressedBytes - total + 1 }).length;
      } catch (e) {
        if (e instanceof RangeError)
          throw new XlsxTooLargeError('Archive inflates past the size limit');
        throw e;
      }
    } else {
      throw new Error('Unsupported zip compression method');
    }
    if (total > maxUncompressedBytes)
      throw new XlsxTooLargeError('Archive inflates past the size limit');
  }
  // jszip keeps reading records while signatures match, whatever the count says.
  if (p !== eocd) throw new Error('Bad zip directory');
}
