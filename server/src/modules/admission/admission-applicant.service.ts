import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, QueryFailedError, Repository } from 'typeorm';
import {
  AdmissionApplicantStatus,
  AdmissionApplicantDocument,
  AdmissionDocumentType,
} from '@biddaloy/shared';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { SchoolsService } from '../schools/schools.service';
import { StorageService } from '../storage/storage.service';
import { tenantObjectKey } from '../storage/storage-key';
import { SubmitApplicantDto } from './dto/submit-applicant.dto';

export interface ApplicantStatusDto {
  status: AdmissionApplicantStatus;
  applicant_name: string;
  intake_title: string;
}

export interface PublicIntakeDto {
  id: string;
  title: string;
  seat_count: number;
  open_date: string;
  close_date: string;
  required_document_types: AdmissionDocumentType[];
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Magic-byte signature check per declared mimetype — a public unauthenticated
 * upload must not trust the client-supplied `mimetype` header on its own,
 * since that's just a form field the caller can set to anything. Only the
 * four types we accept, checked against the first bytes actually written.
 */
function matchesDeclaredType(buffer: Buffer, mimetype: string): boolean {
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

/**
 * [27.2] The unauthenticated admission-submission path. Every method here
 * takes a `slug` (never a tenant id or `X-Tenant-ID`) and resolves the
 * tenant itself — this is the ONLY place in the codebase that does that for
 * a write path with no guard stack in front of it, so every query below is
 * deliberately scoped by the resolved `tenant.id`, never trusted from the
 * request body.
 */
@Injectable()
export class AdmissionApplicantService {
  constructor(
    private readonly schoolsService: SchoolsService,
    private readonly storage: StorageService,
    @InjectRepository(AdmissionIntake)
    private readonly intakeRepo: Repository<AdmissionIntake>,
    @InjectRepository(AdmissionApplicant)
    private readonly applicantRepo: Repository<AdmissionApplicant>,
  ) {}

  /** `GET /public/admission/:slug` — every intake still open for
   * applications (D14: close_date not passed, seats not exhausted). */
  async listOpenIntakes(slug: string): Promise<PublicIntakeDto[]> {
    const school = await this.schoolsService.findBySlug(slug);
    if (!school) throw new NotFoundException('School not found');

    const today = new Date().toISOString().slice(0, 10);
    const intakes = await this.intakeRepo
      .createQueryBuilder('intake')
      .where('intake.tenant_id = :tenantId', { tenantId: school.id })
      .andWhere('intake.open_date <= :today', { today })
      .andWhere('intake.close_date >= :today', { today })
      .getMany();

    const withSeats = await Promise.all(
      intakes.map(async (intake) => {
        const admitted = await this.applicantRepo.count({
          where: {
            tenant_id: school.id,
            intake_id: intake.id,
            status: AdmissionApplicantStatus.ADMITTED,
          },
        });
        return admitted < intake.seat_count ? intake : null;
      }),
    );

    return withSeats
      .filter((i): i is AdmissionIntake => i !== null)
      .map((intake) => ({
        id: intake.id,
        title: intake.title,
        seat_count: intake.seat_count,
        open_date: intake.open_date,
        close_date: intake.close_date,
        required_document_types: intake.required_document_types,
      }));
  }

  /** `GET /public/admission/:slug/status/:referenceNumber` — a caller with
   * only the reference number (no login) can check status. Scoped by the
   * tenant resolved from `:slug`; an unknown reference number, or one
   * belonging to a different tenant, both 404 identically so the response
   * never reveals which field was wrong or that another applicant exists. */
  async getStatus(slug: string, referenceNumber: string): Promise<ApplicantStatusDto> {
    const school = await this.schoolsService.findBySlug(slug);
    if (!school) throw new NotFoundException('Application not found');

    const applicant = await this.applicantRepo.findOne({
      where: { tenant_id: school.id, reference_number: referenceNumber, deleted_at: IsNull() },
    });
    if (!applicant) throw new NotFoundException('Application not found');

    const intake = await this.intakeRepo.findOne({ where: { id: applicant.intake_id } });

    return {
      status: applicant.status,
      applicant_name: applicant.applicant_name,
      intake_title: intake?.title ?? '',
    };
  }

  /**
   * `POST /public/admission/:slug/applicants`. Honeypot short-circuits to a
   * fake-success return before touching the database — a caught bot must
   * see the same 200 shape a real submission gets. Duplicate guard (D9):
   * an existing PENDING row for the same `(tenant_id, intake_id,
   * guardian_phone)` is updated in place instead of a second insert (the
   * partial unique index on that triple would reject the insert anyway).
   */
  async submit(
    slug: string,
    dto: SubmitApplicantDto,
    files: Express.Multer.File[],
  ): Promise<{ reference_number: string; status: string }> {
    const school = await this.schoolsService.findBySlug(slug);
    if (!school) throw new NotFoundException('School not found');

    // Honeypot: return a plausible-looking success without persisting
    // anything, so a bot filling every visible field can't tell it was caught.
    if (dto.middle_name_confirm) {
      return { reference_number: 'ADM-0000-000000', status: AdmissionApplicantStatus.PENDING };
    }

    const documents = await this.uploadDocuments(school.id, files);

    // Seat-count check-then-write is a race under concurrent submissions
    // (D14 requires it hold) — a pessimistic row lock on the intake for the
    // duration of the transaction serializes submissions per intake so two
    // concurrent requests can't both read "seats left" and both insert.
    return this.intakeRepo.manager.transaction(async (manager) => {
      const intake = await manager
        .getRepository(AdmissionIntake)
        .createQueryBuilder('intake')
        .setLock('pessimistic_write')
        .where('intake.id = :id AND intake.tenant_id = :tenantId', {
          id: dto.intake_id,
          tenantId: school.id,
        })
        .getOne();
      if (!intake) throw new NotFoundException('Admission intake not found');

      const today = new Date().toISOString().slice(0, 10);
      if (intake.close_date < today) {
        throw new BadRequestException('This admission intake is closed');
      }

      const applicantRepo = manager.getRepository(AdmissionApplicant);
      const existing = await applicantRepo.findOne({
        where: {
          tenant_id: school.id,
          intake_id: intake.id,
          guardian_phone: dto.guardian_phone,
          status: AdmissionApplicantStatus.PENDING,
        },
      });

      if (existing) {
        existing.applicant_name = dto.applicant_name;
        existing.date_of_birth = dto.date_of_birth;
        existing.gender = dto.gender;
        existing.guardian_name = dto.guardian_name;
        existing.guardian_email = dto.guardian_email ?? null;
        existing.home_address = dto.home_address ?? null;
        if (documents.length > 0) existing.documents = documents;
        const saved = await applicantRepo.save(existing);
        return { reference_number: saved.reference_number, status: saved.status };
      }

      const admittedCount = await applicantRepo.count({
        where: {
          tenant_id: school.id,
          intake_id: intake.id,
          status: AdmissionApplicantStatus.ADMITTED,
        },
      });
      if (admittedCount >= intake.seat_count) {
        throw new BadRequestException('This admission intake has no seats left');
      }

      const saved = await this.createWithReferenceNumber(
        manager,
        school.id,
        intake.id,
        dto,
        documents,
      );
      return { reference_number: saved.reference_number, status: saved.status };
    });
  }

  /** `ADM-<year>-<sequence>` per tenant — the reference_number unique index
   * is `(tenant_id, reference_number)`, so a collision (concurrent
   * submission landing the same sequence) is caught and retried rather
   * than crashing the request; five attempts comfortably covers the race
   * without a dedicated sequence table. */
  private async createWithReferenceNumber(
    manager: EntityManager,
    tenantId: string,
    intakeId: string,
    dto: SubmitApplicantDto,
    documents: AdmissionApplicantDocument[],
  ): Promise<AdmissionApplicant> {
    const applicantRepo = manager.getRepository(AdmissionApplicant);
    const year = new Date().getFullYear();
    const MAX_ATTEMPTS = 5;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const countThisYear = await applicantRepo
        .createQueryBuilder('applicant')
        .where('applicant.tenant_id = :tenantId', { tenantId })
        .andWhere('applicant.reference_number LIKE :prefix', { prefix: `ADM-${year}-%` })
        .withDeleted()
        .getCount();
      const referenceNumber = `ADM-${year}-${String(countThisYear + 1 + attempt).padStart(6, '0')}`;

      try {
        return await applicantRepo.save(
          applicantRepo.create({
            tenant_id: tenantId,
            intake_id: intakeId,
            reference_number: referenceNumber,
            applicant_name: dto.applicant_name,
            date_of_birth: dto.date_of_birth,
            gender: dto.gender,
            guardian_name: dto.guardian_name,
            guardian_phone: dto.guardian_phone,
            guardian_email: dto.guardian_email ?? null,
            home_address: dto.home_address ?? null,
            documents,
            status: AdmissionApplicantStatus.PENDING,
          }),
        );
      } catch (err) {
        const isUniqueViolation =
          err instanceof QueryFailedError && (err as unknown as { code?: string }).code === '23505';
        if (!isUniqueViolation || attempt === MAX_ATTEMPTS - 1) throw err;
      }
    }
    // Unreachable — the loop above always returns or throws.
    throw new Error('createWithReferenceNumber: exhausted retry attempts');
  }

  private async uploadDocuments(
    tenantId: string,
    files: Express.Multer.File[],
  ): Promise<AdmissionApplicantDocument[]> {
    const documents: AdmissionApplicantDocument[] = [];
    for (const file of files ?? []) {
      const type = documentTypeForFieldname(file.fieldname);
      if (!type) continue; // unrecognized field name — ignore rather than reject the whole submission
      const ext = EXT_BY_MIME[file.mimetype];
      if (!ext) continue;
      if (!matchesDeclaredType(file.buffer, file.mimetype)) continue; // content doesn't match declared type — drop it
      const key = tenantObjectKey(tenantId, 'admission-documents', ext);
      await this.storage.put(key, file.buffer, file.mimetype);
      documents.push({ type, storage_key: key });
    }
    return documents;
  }
}

function documentTypeForFieldname(fieldname: string): AdmissionDocumentType | undefined {
  const match = Object.values(AdmissionDocumentType).find(
    (value) => value.toLowerCase() === fieldname.toLowerCase(),
  );
  return match;
}
