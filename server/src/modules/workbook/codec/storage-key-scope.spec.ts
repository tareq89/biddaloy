import { describe, expect, it } from 'vitest';
import { ownKeysIn, ownStorageKey, rehomeStorageKey, storageKeyTail } from './storage-key-scope';

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

describe('ownStorageKey with an area', () => {
  it('keeps an own key inside the area', () => {
    expect(
      ownStorageKey(
        'tenants/b/staff-documents/a.pdf',
        'b',
        'staff_documents',
        2,
        'storage_key',
        'staff-documents',
      ),
    ).toEqual({ key: 'tenants/b/staff-documents/a.pdf' });
  });

  it("rejects the school's own key in another folder (e.g. its workbook backup)", () => {
    expect(
      ownStorageKey(
        'tenants/b/workbook-backups/x.xlsx',
        'b',
        'staff_documents',
        2,
        'storage_key',
        'staff-documents',
      ),
    ).toHaveProperty('error');
  });

  it('does not treat a folder that only starts with the area name as the area', () => {
    expect(
      ownStorageKey(
        'tenants/b/staff-documents-x/a.pdf',
        'b',
        'staff_documents',
        2,
        'storage_key',
        'staff-documents',
      ),
    ).toHaveProperty('error');
  });
});

describe('ownKeysIn (DATA-02)', () => {
  const attachments = { column: 'attachments', field: 'key' };

  it('rewrites a foreign key, keeps the other fields and returns the warning', () => {
    const r = ownKeysIn(
      [{ key: 'tenants/a/h/f.pdf', filename: 'f.pdf' }],
      'b',
      'homework',
      2,
      attachments,
    );
    expect(r).toMatchObject({
      items: [{ key: 'tenants/b/h/f.pdf', filename: 'f.pdf' }],
      warnings: [{ severity: 'warning', column: 'attachments' }],
    });
  });

  it('rejects the row if any element key is outside tenants/ or missing', () => {
    expect(ownKeysIn([{ key: 'backups/db/x' }], 'b', 'homework', 2, attachments)).toHaveProperty(
      'error',
    );
    expect(ownKeysIn([{ filename: 'no-key' }], 'b', 'homework', 2, attachments)).toHaveProperty(
      'error',
    );
  });

  it('scopes a named field such as documents[].storage_key, area-checked', () => {
    const docs = { column: 'documents', field: 'storage_key', area: 'admission-documents' };
    expect(
      ownKeysIn(
        [{ type: 'PHOTO', storage_key: 'tenants/a/admission-documents/p.jpg' }],
        'b',
        'admission_applicants',
        2,
        docs,
      ),
    ).toMatchObject({
      items: [{ type: 'PHOTO', storage_key: 'tenants/b/admission-documents/p.jpg' }],
    });
    expect(
      ownKeysIn(
        [{ type: 'PHOTO', storage_key: 'backups/db/x.dump.age' }],
        'b',
        'admission_applicants',
        2,
        docs,
      ),
    ).toMatchObject({ error: { column: 'documents' } });
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
