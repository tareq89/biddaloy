import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { withMigrationsReverted } from '@test/helpers/db.helper';
import { ClassNameUniqueLiveOnly1791900000500 } from '../src/migrations/1791900000500-ClassNameUniqueLiveOnly';

/** [2885] A soft-deleted class frees its name; two live classes still clash. */
describe('ClassNameUniqueLiveOnly migration (integration)', { timeout: 15000 }, () => {
  let ds: DataSource;
  const migration = new ClassNameUniqueLiveOnly1791900000500();
  const schoolIds: string[] = [];
  let seq = 0;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
  }, 60000);

  afterAll(async () => {
    if (schoolIds.length) {
      await ds.query(`DELETE FROM classes WHERE tenant_id = ANY($1)`, [schoolIds]);
      await ds.query(`DELETE FROM academic_years WHERE tenant_id = ANY($1)`, [schoolIds]);
      await ds.query(`DELETE FROM schools WHERE id = ANY($1)`, [schoolIds]);
    }
    await ds.destroy();
  });

  const mkSchool = async () => {
    const id = randomUUID();
    await ds.query(`INSERT INTO schools (id, name, slug) VALUES ($1, $2, $3)`, [
      id,
      `S ${id}`,
      `s-${id}`,
    ]);
    schoolIds.push(id);
    return id;
  };
  const year = async (tenant: string) => {
    const k = ++seq;
    const [row] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [`Y ${k}`, `${3000 + k}-01-01`, `${3000 + k}-12-31`, tenant],
    );
    return row.id as string;
  };
  const klass = async (tenant: string, yearId: string, name: string) => {
    const [row] = await ds.query(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ($1, $2, $3) RETURNING id`,
      [name, yearId, tenant],
    );
    return row.id as string;
  };
  const softDelete = (id: string) =>
    ds.query(`UPDATE classes SET deleted_at = now() WHERE id = $1`, [id]);

  it('a deleted class frees its name; two live classes still clash', async () => {
    const t = await mkSchool();
    const y = await year(t);
    const first = await klass(t, y, 'Class 6');
    await expect(klass(t, y, 'class 6')).rejects.toMatchObject({
      code: '23505',
      constraint: 'IDX_cl_name_year_tenant_shift_version',
    });
    await softDelete(first);
    await klass(t, y, 'Class 6'); // reuse after delete
    await expect(klass(t, y, 'CLASS 6')).rejects.toMatchObject({ code: '23505' });
  });

  it('down refuses (changing nothing) while a deleted + live pair shares a name', async () => {
    const t = await mkSchool();
    const y = await year(t);
    await softDelete(await klass(t, y, 'Pair Q'));
    await klass(t, y, 'Pair Q');
    const qr = ds.createQueryRunner();
    try {
      const err = await migration.down(qr).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('classes');
      expect((err as Error).message).toContain(t);
      expect((err as Error).message).not.toContain('Pair Q');
      // Nothing changed: the index is still live-only.
      const [{ indexdef }] = await ds.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'IDX_cl_name_year_tenant_shift_version'`,
      );
      expect(indexdef).toContain('deleted_at IS NULL');
    } finally {
      await qr.release();
      await ds.query(`DELETE FROM classes WHERE tenant_id = $1`, [t]);
    }
  });

  it('round-trips: reverted restores the unconditional index, then up restores live-only', async () => {
    // Earlier tests leave deleted+live pairs, which make down() refuse; clear them first.
    await ds.query(`DELETE FROM classes WHERE tenant_id = ANY($1)`, [schoolIds]);
    await withMigrationsReverted(ds, [migration], async () => {
      const t = await mkSchool();
      const y = await year(t);
      await softDelete(await klass(t, y, 'Rt'));
      await expect(klass(t, y, 'Rt')).rejects.toMatchObject({ code: '23505' });
    });
    const t = await mkSchool();
    const y = await year(t);
    await softDelete(await klass(t, y, 'Rt2'));
    await klass(t, y, 'Rt2');
  });
});
