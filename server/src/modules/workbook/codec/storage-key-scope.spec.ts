import { describe, expect, it } from 'vitest';
import { rehomeStorageKey, storageKeyTail } from './storage-key-scope';

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
