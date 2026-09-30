/** Font format by magic bytes only — never the filename or client mimetype. */
export function sniffFont(buf: Buffer): 'ttf' | 'otf' | 'woff2' | null {
  const magic = buf.subarray(0, 4).toString('latin1');
  if (magic === '\x00\x01\x00\x00' || magic === 'true') return 'ttf';
  if (magic === 'OTTO') return 'otf';
  if (magic === 'wOF2') return 'woff2';
  return null;
}
