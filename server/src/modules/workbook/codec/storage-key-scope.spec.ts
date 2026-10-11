import { describe, expect, it } from 'vitest';
import {
  ownAttachments,
  ownStorageKey,
  rehomeStorageKey,
  storageKeyTail,
} from './storage-key-scope';

describe('ownStorageKey (DATA-02)', () => {
  it('keeps an own key without a warning', () => {
    expect(ownStorageKey('tenants/b/x/p.jpg', 'b', 'students', 2, 'photo_key')).toEqual({
      key: 'tenants/b/x/p.jpg',
    });
  });

  it("rewrites another school's key to this school's prefix and returns a warning", () => {
    const r = ownStorageKey('tenants/a/x/p.jpg', 'b', 'students', 2, 'photo_key');
    expect(r).toMatchObject({ key: 'tenants/b/x/p.jpg', warning: { severity: 'warning' } });
  });

  it.each(['backups/db/x.dump.age', 'tenants/b/../a/x', 'students/karim.jpg', ''])(
    'rejects %j with a row error naming the column',
    (raw) => {
      expect(ownStorageKey(raw, 'b', 'students', 7, 'photo_key')).toMatchObject({
        error: { tab: 'students', row: 7, column: 'photo_key', severity: 'error' },
      });
    },
  );
});

describe('ownAttachments (DATA-02)', () => {
  const warn = () => undefined;

  it('rewrites a foreign key and keeps the other fields', () => {
    const r = ownAttachments(
      [{ key: 'tenants/a/h/f.pdf', filename: 'f.pdf' }],
      'b',
      'homework',
      2,
      warn,
    );
    expect(r).toEqual({ attachments: [{ key: 'tenants/b/h/f.pdf', filename: 'f.pdf' }] });
  });

  it('rejects the row if any element key is outside tenants/ or missing', () => {
    expect(ownAttachments([{ key: 'backups/db/x' }], 'b', 'homework', 2, warn)).toHaveProperty(
      'error',
    );
    expect(ownAttachments([{ filename: 'no-key' }], 'b', 'homework', 2, warn)).toHaveProperty(
      'error',
    );
  });
});

describe('rehomeStorageKey', () => {
  it('leaves a key that already belongs to the destination school alone', () => {
    expect(rehomeStorageKey('tenants/b/print-assets/x.png', 'b')).toEqual({
      key: 'tenants/b/print-assets/x.png',
      tail: 'print-assets/x.png',
      moved: false,
    });
  });

  it("swaps another school's id for the destination's (a dangling key, never a foreign file)", () => {
    expect(rehomeStorageKey('tenants/a/student-photo/p.jpg', 'b')).toEqual({
      key: 'tenants/b/student-photo/p.jpg',
      tail: 'student-photo/p.jpg',
      moved: true,
    });
  });

  it('never lets a path climb out of the school folder', () => {
    expect(rehomeStorageKey('tenants/b/../a/secret.png', 'b')).toBeNull();
  });

  it.each(['students/karim.jpg', 'tenants//x.png', 'tenants/a', ''])(
    'reports a key that is not tenant-scoped as null: %j',
    (key) => {
      expect(rehomeStorageKey(key, 'b')).toBeNull();
    },
  );

  it('gives the same tail for the same file in any school', () => {
    expect(storageKeyTail('tenants/a/print-assets/x.png')).toBe('print-assets/x.png');
    expect(storageKeyTail('tenants/b/print-assets/x.png')).toBe('print-assets/x.png');
    expect(storageKeyTail('demo/other.png')).toBe('demo/other.png');
  });
});
