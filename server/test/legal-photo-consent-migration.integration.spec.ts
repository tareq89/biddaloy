import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';

/**
 * [59.1.02] `LegalAndPhotoConsent` landed: photo-consent columns default to UNKNOWN,
 * and `legal_acceptances` rejects a duplicate (user, tenant, document, version).
 * Runs against the already-migrated test database.
 */
describe('LegalAndPhotoConsent migration (integration)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    const module = await createTestModule([...ALL_ENTITIES], []);
    ds = module.get(DataSource);
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('students.photo_consent is NOT NULL and defaults to UNKNOWN', async () => {
    const [col] = await ds.query(
      `SELECT is_nullable, column_default FROM information_schema.columns
       WHERE table_name = 'students' AND column_name = 'photo_consent'`,
    );
    expect(col.is_nullable).toBe('NO');
    expect(col.column_default).toContain("'UNKNOWN'");
  });

  it('admission_applicants.photo_consent is nullable (NULL = applied before this change)', async () => {
    const [col] = await ds.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'admission_applicants' AND column_name = 'photo_consent'`,
    );
    expect(col.is_nullable).toBe('YES');
  });

  it('rejects a duplicate (user, tenant, document, version) and an unknown document', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await ds.query(`INSERT INTO schools (id, name, slug) VALUES ($1, $2, $3)`, [
      tenantId,
      `Legal School ${tenantId}`,
      `legal-school-${tenantId}`,
    ]);
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name)
       VALUES ($1, $2, 'x', 'Legal Test')`,
      [userId, `legal-${userId}@example.test`],
    );
    const insert = (doc: string) =>
      ds.query(
        `INSERT INTO legal_acceptances (user_id, tenant_id, document, version)
         VALUES ($1, $2, $3, '1.0')`,
        [userId, tenantId, doc],
      );
    await insert('terms');
    // Same document + version twice must fail.
    await expect(insert('terms')).rejects.toThrow(/UQ_legal_acceptances/);
    // The CHECK pins the document list.
    await expect(insert('bogus')).rejects.toThrow(/CHK_legal_acceptances_document/);
  });
});
