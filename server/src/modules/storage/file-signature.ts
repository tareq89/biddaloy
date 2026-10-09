/**
 * Magic-byte signature check per declared mimetype — an upload must not
 * trust the client-supplied `mimetype` field on its own, since that's just
 * a form field the caller can set to anything. Only the four types we
 * accept, checked against the first bytes actually written.
 */
export function matchesDeclaredType(buffer: Buffer, mimetype: string): boolean {
  switch (mimetype) {
    case 'image/png':
      return buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    case 'image/jpeg':
      return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    case 'image/webp':
      return (
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    case 'application/pdf':
      return buffer.subarray(0, 4).toString('ascii') === '%PDF';
    default:
      return false;
  }
}
