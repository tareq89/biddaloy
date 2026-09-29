import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Readable } from 'stream';
import sharp from 'sharp';
import { UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID, SEED_SECTION_1_ID, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { FamilyAccessService } from './family-access.service';
import { StudentPhotoService } from './student-photo.service';
import { StudentPhotoController } from './student-photo.controller';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';

/**
 * [32.2.5] Photo upload/serve against a real DB with an in-memory object
 * store. Controller methods are called directly (guards are covered by the
 * shared guard specs); what matters here is that the GET path runs the real
 * `familyAccess.assertLinked` and the bulk match is tenant-scoped.
 */

const TENANT_B = '00000000-0000-4000-8000-0000005b0001';
const PARENT_USER_ID = '00000000-0000-4000-8000-0000005b0010';

class MemoryStorage {
  objects = new Map<string, { body: Buffer; contentType: string }>();
  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
    return { body: Readable.from([o.body]), contentType: o.contentType };
  }
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

describe('Student photos (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let studentRepo: Repository<Student>;
  let guardianRepo: Repository<Guardian>;
  let controller: StudentPhotoController;
  let storage: MemoryStorage;
  const req = { headers: {}, ip: '1.1.1.1' } as any;

  beforeAll(async () => {
    storage = new MemoryStorage();
    moduleRef = await createTestModule(
      ALL_ENTITIES,
      [
        StudentPhotoService,
        FamilyAccessService,
        AuditService,
        { provide: StorageService, useValue: storage },
      ],
      [],
    );
    dataSource = moduleRef.get(DataSource);
    studentRepo = moduleRef.get(getRepositoryToken(Student));
    guardianRepo = moduleRef.get(getRepositoryToken(Guardian));
    controller = new StudentPhotoController(
      moduleRef.get(StudentPhotoService),
      moduleRef.get(FamilyAccessService),
    );

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Photo Tenant B', 'photo-tenant-b', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'photo-parent@test.example', $2, 'Photo Parent', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, SEED_ADMIN_PASSWORD_HASH],
    );
  }, 60000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM student_guardians`);
    await dataSource.query(`DELETE FROM students WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      TENANT_B,
    ]);
    await dataSource.query(`DELETE FROM guardians WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [PARENT_USER_ID]);
    await dataSource.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM student_guardians`);
    await dataSource.query(`DELETE FROM students WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      TENANT_B,
    ]);
    await dataSource.query(`DELETE FROM guardians WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    storage.objects.clear();
  });

  const makeStudent = (reg: string) =>
    studentRepo.save(
      studentRepo.create({
        full_name: `Kid ${reg}`,
        registration_number: reg,
        roll_number: Math.floor(Math.random() * 100000),
        class_section_id: SEED_SECTION_1_ID,
        tenant_id: SEED_TENANT_ID,
      } as Partial<Student>),
    );

  const png = () =>
    sharp({ create: { width: 64, height: 64, channels: 3, background: '#00f' } })
      .png()
      .toBuffer();

  const file = async (name: string) =>
    ({ buffer: await png() }) as Express.Multer.File & { name: string };
  const parentTenant = { id: SEED_TENANT_ID, role: UserRole.PARENT };
  const adminTenant = { id: SEED_TENANT_ID, role: UserRole.ADMIN };

  function res() {
    const headers: Record<string, string> = {};
    return { headers, setHeader: (k: string, v: string) => (headers[k] = v) } as any;
  }

  it('upload then GET streams a JPEG', async () => {
    const s = await makeStudent('P-1');
    await controller.upload(s.id, await file('a'), adminTenant, { sub: 'admin' } as any, req);
    const out = await controller.serve(s.id, adminTenant, { sub: 'admin' } as any, res());
    const bytes = await readAll(out.getStream());
    expect((await sharp(bytes).metadata()).format).toBe('jpeg');
    expect((await studentRepo.findOneByOrFail({ id: s.id })).photo_key).toContain(
      `tenants/${SEED_TENANT_ID}/student-photo/`,
    );
  });

  it('sets Cache-Control private, no-store on GET', () => {
    const meta = Reflect.getMetadata('__headers__', StudentPhotoController.prototype.serve);
    expect(meta).toEqual(
      expect.arrayContaining([{ name: 'Cache-Control', value: 'private, no-store' }]),
    );
  });

  it("a PARENT can read their own child's photo but not another child's", async () => {
    const mine = await makeStudent('P-2');
    const other = await makeStudent('P-3');
    for (const s of [mine, other]) {
      await controller.upload(s.id, await file('a'), adminTenant, { sub: 'admin' } as any, req);
    }
    const guardian = await guardianRepo.save(
      guardianRepo.create({
        full_name: 'Parent',
        relationship: 'FATHER',
        phone: '+8801700000001',
        email: 'photo-guardian@test.example',
        tenant_id: SEED_TENANT_ID,
        user_id: PARENT_USER_ID,
      } as Partial<Guardian>),
    );
    await dataSource
      .createQueryBuilder()
      .relation(Guardian, 'students')
      .of(guardian)
      .add([mine.id]);

    const user = { sub: PARENT_USER_ID } as any;
    await expect(controller.serve(mine.id, parentTenant, user, res())).resolves.toBeDefined();
    await expect(controller.serve(other.id, parentTenant, user, res())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('bulk match never touches the same registration number in another tenant', async () => {
    const mine = await makeStudent('DUP-1');
    await studentRepo.save(
      studentRepo.create({
        full_name: 'Other tenant kid',
        registration_number: 'DUP-1',
        roll_number: 1,
        class_section_id: null,
        tenant_id: TENANT_B,
      } as unknown as Partial<Student>),
    );
    const files = [{ originalname: 'DUP-1.png', buffer: await png() }] as Express.Multer.File[];
    const out = await controller.bulk(files, adminTenant, { sub: 'admin' } as any, req);
    expect(out.matched).toHaveLength(1);
    expect(out.matched[0].student_id).toBe(mine.id);
    const theirs = await studentRepo.findOneByOrFail({
      registration_number: 'DUP-1',
      tenant_id: TENANT_B,
    });
    expect(theirs.photo_key).toBeNull();
  });
});
