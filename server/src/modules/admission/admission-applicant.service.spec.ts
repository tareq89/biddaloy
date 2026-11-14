import { describe, expect, it, vi } from 'vitest';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { AdmissionApplicantStatus, type AdmissionApplicantDocument } from '@biddaloy/shared';
import { StorageService } from '../storage/storage.service';
import type { SchoolsService } from '../schools/schools.service';
import { AdmissionApplicantService } from './admission-applicant.service';
import { AdmissionFormSchemaService } from './admission-form-schema.service';
import { AdmissionIntake } from './entities/admission-intake.entity';
import type { SubmitApplicantDto } from './dto/submit-applicant.dto';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const INTAKE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REFERENCE = 'ADM-2026-ABC123';
const PHONE = '01700000001';
const VALID_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

/**
 * The real StorageService (so its tenant guard is what runs), with the S3 client
 * swapped for a recorder: `sent` lists every command that would reach the bucket.
 */
function recordingStorage() {
  const storage = new StorageService({
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    bucket: 'test',
    accessKeyId: 'k',
    secretAccessKey: 's',
    forcePathStyle: true,
  });
  const sent: unknown[] = [];
  (storage as unknown as { client: { send: (c: unknown) => Promise<object> } }).client = {
    send: async (command: unknown) => {
      sent.push(command);
      return {};
    },
  };
  const deletedKeys = () =>
    sent
      .filter((c): c is DeleteObjectCommand => c instanceof DeleteObjectCommand)
      .map((c) => c.input.Key);
  return { storage, deletedKeys };
}

/** A PENDING applicant (already stored) holding `documents`, resubmitted with a new PHOTO. */
async function resubmitPhoto(documents: AdmissionApplicantDocument[]) {
  const { storage, deletedKeys } = recordingStorage();
  const rawDelete = vi.spyOn(storage, 'delete');
  const deleteForTenant = vi.spyOn(storage, 'deleteForTenant');

  const existing = {
    tenant_id: TENANT,
    intake_id: INTAKE_ID,
    reference_number: REFERENCE,
    guardian_phone: PHONE,
    status: AdmissionApplicantStatus.PENDING,
    documents,
  };
  const intake = {
    id: INTAKE_ID,
    tenant_id: TENANT,
    open_date: '2000-01-01',
    close_date: '2999-12-31',
    seat_count: 10,
    required_document_types: ['PHOTO'],
  };
  const qb = { setLock: () => qb, where: () => qb, getOne: async () => intake };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === AdmissionIntake
        ? { createQueryBuilder: () => qb }
        : { find: async () => [existing], save: async (x: unknown) => x },
  };
  const intakeRepo = {
    manager: { transaction: (cb: (m: typeof manager) => unknown) => cb(manager) },
  };
  const schools = {
    findBySlug: async () => ({ id: TENANT }),
    todayFor: async () => '2026-03-16',
  } as unknown as SchoolsService;

  const service = new AdmissionApplicantService(
    schools,
    storage,
    intakeRepo as never,
    {} as never,
    {
      forTenant: async () => ({ platform: {}, school: {} }),
    } as never,
    new AdmissionFormSchemaService(),
    { findByPhoneAnyFormat: async () => null } as never,
  );
  const dto = {
    intake_id: INTAKE_ID,
    reference_number: REFERENCE,
    applicant_name: 'Rahim',
    date_of_birth: '2015-01-01',
    gender: 'MALE',
    guardian_name: 'Karim',
    guardian_phone: PHONE,
  } as SubmitApplicantDto;
  const photo = { fieldname: 'photo', mimetype: 'image/jpeg', buffer: VALID_JPEG };

  await service.submit('test-school', dto, [photo as Express.Multer.File]);
  return { deletedKeys: deletedKeys(), rawDelete, deleteForTenant };
}

// DATA-02: `POST /public/admission/:slug/applicants` needs no login and deletes the
// documents a resubmission replaces. A stored key can come from a restored workbook,
// so the delete must never reach outside this school's own prefix.
describe('AdmissionApplicantService.submit replacing documents (DATA-02)', () => {
  it('never deletes a platform DB backup a stored document points at', async () => {
    const { deletedKeys, rawDelete, deleteForTenant } = await resubmitPhoto([
      { type: 'PHOTO', storage_key: 'backups/db/20261009T020000Z.dump.age' } as never,
    ]);

    expect(deleteForTenant).toHaveBeenCalledWith('backups/db/20261009T020000Z.dump.age', TENANT);
    expect(rawDelete).not.toHaveBeenCalled();
    expect(deletedKeys).toEqual([]);
  });

  it("never deletes another school's file a stored document points at", async () => {
    const foreign = `tenants/${OTHER_TENANT}/admission-documents/p.jpg`;
    const { deletedKeys, rawDelete } = await resubmitPhoto([
      { type: 'PHOTO', storage_key: foreign } as never,
    ]);

    expect(rawDelete).not.toHaveBeenCalled();
    expect(deletedKeys).toEqual([]);
  });

  it("still deletes the replaced document when it is this school's own", async () => {
    const own = `tenants/${TENANT}/admission-documents/old.jpg`;
    const { deletedKeys, rawDelete, deleteForTenant } = await resubmitPhoto([
      { type: 'PHOTO', storage_key: own } as never,
    ]);

    expect(deletedKeys).toEqual([own]);
    // The service only goes through the tenant-scoped delete; the raw `delete`
    // runs solely as the inner step of `deleteForTenant` after its guard passed.
    expect(deleteForTenant).toHaveBeenCalledTimes(1);
    expect(rawDelete).toHaveBeenCalledTimes(1);
  });
});

// Epic 71 D5/D10/D18: extra fields follow the round's ticked list; quota + sibling are tags.
describe('AdmissionApplicantService.submit extra fields', () => {
  async function submitWith(extra: Record<string, unknown> | undefined, guardian: unknown = null) {
    const intake = {
      id: INTAKE_ID,
      tenant_id: TENANT,
      open_date: '2000-01-01',
      close_date: '2999-12-31',
      seat_count: 10,
      required_document_types: [],
      form_fields: ['name', 'father_name', 'quota_disabled'],
    };
    const qb = { setLock: () => qb, where: () => qb, getOne: async () => intake };
    const saved: Record<string, unknown>[] = [];
    const applicantRepo = {
      find: async () => [],
      count: async () => 0,
      exists: async () => false,
      create: (x: Record<string, unknown>) => x,
      save: async (x: Record<string, unknown>) => {
        saved.push(x);
        return { ...x, reference_number: 'ADM-2026-ZZZZZZ', status: 'PENDING' };
      },
      createQueryBuilder: () => ({
        where: () => ({ andWhere: () => ({ getCount: async () => 0 }) }),
      }),
    };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === AdmissionIntake ? { createQueryBuilder: () => qb } : applicantRepo,
    };
    const service = new AdmissionApplicantService(
      { findBySlug: async () => ({ id: TENANT }), todayFor: async () => '2026-03-16' } as never,
      recordingStorage().storage,
      { manager: { transaction: (cb: (m: typeof manager) => unknown) => cb(manager) } } as never,
      {} as never,
      { forTenant: async () => ({ platform: {}, school: {} }) } as never,
      new AdmissionFormSchemaService(),
      { findByPhoneAnyFormat: async () => guardian } as never,
    );
    const dto = {
      intake_id: INTAKE_ID,
      applicant_name: 'Rahim',
      date_of_birth: '2015-01-01',
      gender: 'MALE',
      guardian_name: 'Karim',
      guardian_phone: PHONE,
      extra_fields: extra,
    } as SubmitApplicantDto;
    const result = await service.submit('test-school', dto, []).then(
      (r) => ({ r }),
      (e: unknown) => ({ e }),
    );
    return { saved, ...result };
  }

  it('rejects a bad value with a field-keyed error that never echoes the value', async () => {
    const out = await submitWith({ father_name: 'Abdul', quota_disabled: 'SECRET-VALUE' });
    const body = JSON.stringify((out as { e: { getResponse(): unknown } }).e.getResponse());
    expect(body).toContain('quota_disabled');
    expect(body).toContain('INVALID');
    expect(body).not.toContain('SECRET-VALUE');
    expect(out.saved).toEqual([]);
  });

  it('rejects a field the round did not tick without echoing its key', async () => {
    const out = await submitWith({ father_name: 'Abdul', ssc_gpa: 5 });
    const body = JSON.stringify((out as { e: { getResponse(): unknown } }).e.getResponse());
    expect(body).toContain('UNKNOWN_FIELD');
    expect(body).not.toContain('ssc_gpa');
  });

  it('stores extra fields and quota tags', async () => {
    const out = await submitWith({ father_name: 'Abdul', quota_disabled: true });
    expect(out.saved[0]).toMatchObject({
      extra_fields: { father_name: 'Abdul', quota_disabled: true },
      quota_tags: ['quota_disabled'],
      sibling_student_id: null,
    });
  });

  it('sets the sibling tag when the guardian phone matches an existing student', async () => {
    const out = await submitWith(
      { father_name: 'Abdul' },
      {
        students: [
          { id: 'stu-1', deleted_at: new Date() },
          { id: 'stu-2', deleted_at: null },
        ],
      },
    );
    expect(out.saved[0]).toMatchObject({ sibling_student_id: 'stu-2' });
  });
});
