import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { withMigrationsReverted } from '@test/helpers/db.helper';
import { CaseInsensitiveAcademicNames1791900000400 } from '../src/migrations/1791900000400-CaseInsensitiveAcademicNames';

/**
 * [2657] Year, class and section names that differ only by letter case clash inside one
 * school. Runs on the migrated test DB; round-trips the migration.
 */
describe('CaseInsensitiveAcademicNames migration (integration)', { timeout: 15000 }, () => {
  let ds: DataSource;
  const migration = new CaseInsensitiveAcademicNames1791900000400();
  const schoolIds: string[] = [];
  let seq = 0;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
  }, 60000);

  afterAll(async () => {
    // Years cascade to classes and sections.
    if (schoolIds.length) {
      await ds.query(`DELETE FROM class_sections WHERE tenant_id = ANY($1)`, [schoolIds]);
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
  const n = () => ++seq;
  const year = async (tenant: string, name: string) => {
    const k = n();
    const [row] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, `${3000 + k}-01-01`, `${3000 + k}-12-31`, tenant],
    );
    return row.id as string;
  };
  const klass = async (
    tenant: string,
    yearId: string,
    name: string,
    shift: string | null = null,
    version: string | null = null,
  ) => {
    const [row] = await ds.query(
      `INSERT INTO classes (name, academic_year_id, tenant_id, shift, version)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, yearId, tenant, shift, version],
    );
    return row.id as string;
  };
  const section = (tenant: string, classId: string, name: string) =>
    ds.query(`INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, $2, $3)`, [
      classId,
      name,
      tenant,
    ]);

  const clash = (index: string) => ({ code: '23505', constraint: index });

  it('year: a case-only clash in one school fails; another school and a soft-deleted twin are fine', async () => {
    const [a, b] = [await mkSchool(), await mkSchool()];
    const id = await year(a, `Session X ${n()}`);
    const name = (await ds.query(`SELECT name FROM academic_years WHERE id = $1`, [id]))[0].name;
    await expect(year(a, name.toLowerCase())).rejects.toMatchObject(clash('IDX_ay_name_tenant'));
    await year(b, name.toLowerCase());
    await ds.query(`UPDATE academic_years SET deleted_at = now() WHERE id = $1`, [id]);
    await year(a, name.toLowerCase());
  });

  it('class: a case-only clash in one year fails; a different shift is allowed; NULL shift and version clash', async () => {
    const a = await mkSchool();
    const yearId = await year(a, `Y ${n()}`);
    await klass(a, yearId, 'Grade Q');
    await expect(klass(a, yearId, 'grade q')).rejects.toMatchObject(
      clash('IDX_cl_name_year_tenant_shift_version'),
    );
    await klass(a, yearId, 'grade q', 'Morning');
    await klass(a, yearId, 'Grade Q', 'Day', 'Bangla');
    await expect(klass(a, yearId, 'GRADE Q', 'Day', 'Bangla')).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('section: a case-only clash in one class fails; another class is fine', async () => {
    const a = await mkSchool();
    const yearId = await year(a, `Y ${n()}`);
    const [c1, c2] = [await klass(a, yearId, `C1 ${n()}`), await klass(a, yearId, `C2 ${n()}`)];
    await section(a, c1, 'Blue');
    await expect(section(a, c1, 'BLUE')).rejects.toMatchObject(clash('IDX_cs_name_class'));
    await section(a, c2, 'BLUE');
  });

  it('Bangla names: an exact repeat still fails (lower is a no-op on Bengali script)', async () => {
    const a = await mkSchool();
    const yearId = await year(a, `Y ${n()}`);
    await klass(a, yearId, 'শ্রেণি ১');
    await expect(klass(a, yearId, 'শ্রেণি ১')).rejects.toMatchObject({ code: '23505' });
  });

  // up() must stop before changing anything while a case-only duplicate exists.
  it.each([
    [
      'academic_years',
      async (t: string) => {
        await year(t, 'Session Y');
        await year(t, 'session y');
      },
    ],
    [
      'classes',
      async (t: string) => {
        const y = await year(t, `Y ${n()}`);
        await klass(t, y, 'Grade Y');
        await klass(t, y, 'grade y');
      },
    ],
    [
      'class_sections',
      async (t: string) => {
        const c = await klass(t, await year(t, `Y ${n()}`), `C ${n()}`);
        await section(t, c, 'Red');
        await section(t, c, 'RED');
      },
    ],
  ])('up refuses on a %s duplicate, names the table and never the name', async (table, seed) => {
    const tenant = await mkSchool();
    let err: Error | null = null;
    await withMigrationsReverted(ds, [migration], async () => {
      await seed(tenant); // the exact-case indexes are back, so the twins insert
      const qr = ds.createQueryRunner();
      try {
        await migration.up(qr).catch((e: Error) => (err = e));
      } finally {
        await qr.release();
      }
      // Clean up so the harness can run up() again.
      await ds.query(`DELETE FROM class_sections WHERE tenant_id = $1`, [tenant]);
      await ds.query(`DELETE FROM classes WHERE tenant_id = $1`, [tenant]);
      await ds.query(`DELETE FROM academic_years WHERE tenant_id = $1`, [tenant]);
    });
    const message = (err as Error | null)?.message ?? '';
    expect(message).toContain(table);
    expect(message).toContain(tenant);
    expect(message).not.toMatch(/Session Y|Grade Y|Red/i);
  });

  it('up ignores a soft-deleted case twin (deleted_at IS NULL predicate)', async () => {
    const tenant = await mkSchool();
    await withMigrationsReverted(ds, [migration], async () => {
      await year(tenant, 'Session Z');
      const id = await year(tenant, 'session z');
      await ds.query(`UPDATE academic_years SET deleted_at = now() WHERE id = $1`, [id]);
      const qr = ds.createQueryRunner();
      try {
        await expect(migration.up(qr)).resolves.toBeUndefined();
        await migration.down(qr); // put the exact-case indexes back for the harness
      } finally {
        await qr.release();
      }
      await ds.query(`DELETE FROM academic_years WHERE tenant_id = $1`, [tenant]);
    });
  });

  it('round-trips: down restores the exact-case indexes, up restores the case-insensitive ones', async () => {
    await withMigrationsReverted(ds, [migration], async () => {
      const a = await mkSchool();
      const yearId = await year(a, `Y ${n()}`);
      await klass(a, yearId, 'Rt');
      await klass(a, yearId, 'rt'); // an exact-case twin is allowed again while reverted
      await ds.query(`DELETE FROM classes WHERE tenant_id = $1 AND name = 'rt'`, [a]);
    });
    const a = await mkSchool();
    const yearId = await year(a, `Y ${n()}`);
    await klass(a, yearId, 'Rt2');
    await expect(klass(a, yearId, 'rt2')).rejects.toMatchObject({ code: '23505' });
  });
});
