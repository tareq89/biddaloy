import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_PASSWORD_HASH, SEED_SECTION_1_ID, SEED_TENANT_ID } from '@test/constants';
import {
  ApplicationStatus,
  ApplicationType,
  TeacherAssignmentType,
  UserRole,
} from '@biddaloy/shared';
import { AuthModule } from '../auth/auth.module';
import { Teacher } from '../academics/entities/teacher.entity';
import { StorageService } from '../storage/storage.service';
import { ApplicationsModule } from './applications.module';
import { ApplicationsService } from './applications.service';
import { ApplicationLetterService } from './application-letter.service';
import { ApplicationNotifyService } from './application-notify.service';
import { ApplicationAttachmentsService } from './application-attachments.service';
import type { ApplicationCaller } from './reviewer-scope';
import { Application } from './entities/application.entity';
import { ApplicationAttachment } from './entities/application-attachment.entity';

// Real file headers: matchesDeclaredType only inspects the first bytes.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = Buffer.from('%PDF-1.4 test');
const WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'binary');

const file = (name: string, mimetype: string, buffer: Buffer): Express.Multer.File =>
  ({ originalname: name, mimetype, buffer, size: buffer.length }) as Express.Multer.File;

/**
 * [52.2.3] Attachments against the real test DB. Only object storage is faked (spied).
 * Cast (tenant A): parent files a STUDENT_LEAVE for studentA; ct is studentA's class teacher;
 * other is a teacher with no tie to it.
 */
describe('ApplicationAttachmentsService (integration)', () => {
  let service: ApplicationAttachmentsService;
  let applications: ApplicationsService;
  let storage: StorageService;
  let dataSource: DataSource;
  let put: ReturnType<typeof vi.fn>;
  let del: ReturnType<typeof vi.fn>;

  const TENANT_B = randomUUID();
  const ctx = { ip: null, userAgent: null };
  const u = { parent: randomUUID(), ct: randomUUID(), other: randomUUID(), bAdmin: randomUUID() };
  const parent: ApplicationCaller = { userId: u.parent, role: UserRole.PARENT };
  const ct: ApplicationCaller = { userId: u.ct, role: UserRole.TEACHER };
  const other: ApplicationCaller = { userId: u.other, role: UserRole.TEACHER };
  const bAdmin: ApplicationCaller = { userId: u.bAdmin, role: UserRole.ADMIN };
  let appId: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), ApplicationsModule, AuthModule],
    );
    service = module.get(ApplicationAttachmentsService);
    applications = module.get(ApplicationsService);
    storage = module.get(StorageService);
    dataSource = module.get<DataSource>(getDataSourceToken());
    const letter = module.get(ApplicationLetterService);
    const notify = module.get(ApplicationNotifyService);
    vi.spyOn(letter, 'buildContext').mockResolvedValue({
      locale: 'en',
      date: '2026-10-09',
      school_name: '',
      to_title: '',
      applicant_name: '',
      applicant_relation: '',
      serial: null,
      subject_name: '',
      class_name: null,
      section_name: null,
      roll: null,
      ref_names: {},
      days: null,
    });
    vi.spyOn(letter, 'render').mockReturnValue('x');
    for (const m of ['onSubmitted', 'onTagged', 'onComment', 'onStatusChanged'] as const) {
      vi.spyOn(notify, m).mockResolvedValue();
    }

    for (const [id, role] of [
      [u.parent, UserRole.PARENT],
      [u.ct, UserRole.TEACHER],
      [u.other, UserRole.TEACHER],
      [u.bAdmin, UserRole.ADMIN],
    ] as Array<[string, UserRole]>) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, `att-${id}@test.com`, SEED_ADMIN_PASSWORD_HASH, `Name ${role}`],
      );
    }
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Attachments Tenant B', $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_B, `attachments-b-${TENANT_B.slice(0, 8)}`],
    );
    for (const [id, tenant, role] of [
      [u.parent, SEED_TENANT_ID, 'PARENT'],
      [u.ct, SEED_TENANT_ID, 'TEACHER'],
      [u.other, SEED_TENANT_ID, 'TEACHER'],
      [u.bAdmin, TENANT_B, 'ADMIN'],
    ]) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, tenant, role],
      );
    }
  }, 90000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    put = vi.fn().mockResolvedValue(undefined);
    del = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(storage, 'put').mockImplementation(put);
    vi.spyOn(storage, 'delete').mockImplementation(del);
    vi.spyOn(storage, 'get').mockImplementation(
      async () => ({ body: {} as never, contentType: 'application/pdf' }) as never,
    );

    const student = (
      await dataSource.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
                               enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ('Student A', $1, $2, $3, $4, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
        [
          `AT-${randomUUID().slice(0, 10)}`,
          Math.floor(Math.random() * 1e6),
          SEED_SECTION_1_ID,
          SEED_TENANT_ID,
        ],
      )
    )[0].id as string;
    const guardian = (
      await dataSource.query(
        `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                                preferred_communication, is_primary_contact, created_at, updated_at)
         VALUES ('Guardian P', 'FATHER', '+8801700000000', $1, $2, $3, 'SMS', true, NOW(), NOW()) RETURNING id`,
        [`g-${randomUUID()}@test.com`, SEED_TENANT_ID, u.parent],
      )
    )[0].id as string;
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
      [student, guardian],
    );
    const ctTeacher = await dataSource.getRepository(Teacher).save({
      user_id: u.ct,
      tenant_id: SEED_TENANT_ID,
      employee_id: `AT-${randomUUID().slice(0, 12)}`,
      designations: [],
    });
    await dataSource.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [ctTeacher.id, SEED_SECTION_1_ID, SEED_TENANT_ID, TeacherAssignmentType.CLASS_TEACHER],
    );
    await dataSource.getRepository(Teacher).save({
      user_id: u.other,
      tenant_id: SEED_TENANT_ID,
      employee_id: `AT-${randomUUID().slice(0, 12)}`,
      designations: [],
    });

    appId = (
      await applications.submit(
        SEED_TENANT_ID,
        parent,
        {
          type: ApplicationType.STUDENT_LEAVE,
          subject_student_id: student,
          payload: {
            reason_kind: 'SICK',
            start_date: '2026-10-12',
            end_date: '2026-10-14',
            details: 'Fever, doctor advised rest',
          },
        },
        ctx,
      )
    ).id;
  });

  const rows = () =>
    dataSource.getRepository(ApplicationAttachment).find({ where: { application_id: appId } });
  const upload = (files: Express.Multer.File[], c = parent) =>
    service.upload(SEED_TENANT_ID, c, appId, files);
  const pdf = (n = 'a.pdf') => file(n, 'application/pdf', PDF);

  describe('upload', () => {
    it('applicant uploads 2 valid files: 2 rows, 2 puts, 2 audit rows', async () => {
      const res = await upload([pdf('prescription.pdf'), file('xray.jpg', 'image/jpeg', JPEG)]);
      expect(res.map((r) => r.file_name)).toEqual(['prescription.pdf', 'xray.jpg']);
      expect(await rows()).toHaveLength(2);
      expect(put).toHaveBeenCalledTimes(2);
      const audits = await dataSource.query(
        `SELECT 1 FROM audit_logs WHERE entity_type = 'ApplicationAttachment' AND action = 'CREATE'
           AND tenant_id = $1`,
        [SEED_TENANT_ID],
      );
      expect(audits).toHaveLength(2);
    });

    it('a PNG declared as PDF is a 400 and nothing in the batch is stored', async () => {
      await expect(
        upload([pdf(), file('fake.pdf', 'application/pdf', PNG)]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(put).not.toHaveBeenCalled();
      expect(await rows()).toHaveLength(0);
    });

    it('a WebP is a 400', async () => {
      await expect(upload([file('a.webp', 'image/webp', WEBP)])).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('an empty list is a 400', async () => {
      await expect(upload([])).rejects.toBeInstanceOf(BadRequestException);
    });

    it('2 existing + 2 new is 422 APPLICATION_ATTACHMENT_LIMIT', async () => {
      await upload([pdf('1.pdf'), pdf('2.pdf')]);
      put.mockClear();
      const err = await upload([pdf('3.pdf'), file('4.png', 'image/png', PNG)]).catch((e) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect(err.getResponse().details).toEqual({ code: 'APPLICATION_ATTACHMENT_LIMIT', max: 3 });
      expect(put).not.toHaveBeenCalled();
      expect(await rows()).toHaveLength(2);
    });

    it('a non-applicant who can see the application gets 403; a stranger gets 404', async () => {
      await expect(upload([pdf()], ct)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(upload([pdf()], other)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('upload on a non-PENDING application is 422 APPLICATION_NOT_PENDING', async () => {
      await dataSource
        .getRepository(Application)
        .update({ id: appId }, { status: ApplicationStatus.APPROVED });
      const err = await upload([pdf()]).catch((e) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect(err.getResponse().details.code).toBe('APPLICATION_NOT_PENDING');
    });

    it('when the row save fails every uploaded key is deleted', async () => {
      vi.spyOn(dataSource.manager.connection, 'transaction').mockRejectedValueOnce(
        new Error('db down'),
      );
      await expect(upload([pdf('1.pdf'), pdf('2.pdf')])).rejects.toThrow('db down');
      expect(put).toHaveBeenCalledTimes(2);
      expect(del).toHaveBeenCalledTimes(2);
      expect(del.mock.calls.map((c) => c[0]).sort()).toEqual(
        put.mock.calls.map((c) => c[0]).sort(),
      );
    });
  });

  describe('open', () => {
    it('a viewer (class teacher) downloads with the right content type; strangers and other tenants get 404', async () => {
      const [saved] = await upload([pdf('a.pdf')]);
      const res = await service.open(SEED_TENANT_ID, ct, appId, saved.id);
      expect(res.file.mime_type).toBe('application/pdf');
      expect(res.object.contentType).toBe('application/pdf');
      await expect(service.open(SEED_TENANT_ID, other, appId, saved.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // Tenant isolation: tenant B's admin with tenant A's ids.
      await expect(service.open(TENANT_B, bAdmin, appId, saved.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.open(SEED_TENANT_ID, ct, appId, randomUUID())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('applicant deletes: row gone, object deleted, audited; a viewer cannot (403)', async () => {
      const [saved] = await upload([pdf()]);
      await expect(service.remove(SEED_TENANT_ID, ct, appId, saved.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await service.remove(SEED_TENANT_ID, parent, appId, saved.id);
      expect(await rows()).toHaveLength(0);
      expect(del).toHaveBeenCalledTimes(1);
      const audits = await dataSource.query(
        `SELECT 1 FROM audit_logs WHERE entity_type = 'ApplicationAttachment' AND action = 'DELETE'`,
      );
      expect(audits.length).toBeGreaterThanOrEqual(1);
    });

    it('delete after WITHDRAWN is 422', async () => {
      const [saved] = await upload([pdf()]);
      await dataSource
        .getRepository(Application)
        .update({ id: appId }, { status: ApplicationStatus.WITHDRAWN });
      await expect(service.remove(SEED_TENANT_ID, parent, appId, saved.id)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(await rows()).toHaveLength(1);
    });
  });
});
