import { randomInt } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
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
import { CheckApplicantStatusDto } from './dto/check-applicant-status.dto';
import { normalizeBdPhoneNumber } from '../communications/providers/shared/phone-number.util';

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

  /** `POST /public/admission/:slug/status` — the guardian phone given on
   * the form is a second factor alongside the reference number, so a
   * caller can't enumerate reference numbers to look up other applicants'
   * status. Scoped by the tenant resolved from `:slug`; an unknown
   * reference, a wrong phone, and a wrong-tenant reference number all 404
   * identically so the response never reveals which field was wrong or
   * that another applicant exists. */
  async getStatus(slug: string, dto: CheckApplicantStatusDto): Promise<ApplicantStatusDto> {
    const school = await this.schoolsService.findBySlug(slug);
    if (!school) throw new NotFoundException('Application not found');

    const referenceNumber = normalizeReferenceNumber(dto.reference_number);
    const applicant = await this.applicantRepo.findOne({
      where: { tenant_id: school.id, reference_number: referenceNumber, deleted_at: IsNull() },
    });
    if (
      !applicant ||
      normalizeBdPhoneNumber(applicant.guardian_phone) !==
        normalizeBdPhoneNumber(dto.guardian_phone)
    ) {
      throw new NotFoundException('Application not found');
    }

    const intake = await this.intakeRepo.findOne({ where: { id: applicant.intake_id } });

    return {
      status: applicant.status,
      applicant_name: applicant.applicant_name,
      intake_title: intake?.title ?? '',
    };
  }

  /**
   * `POST /public/admission/:slug/applicants`. Honeypot short-circuits to a
   * fake-success return before touching the database (and before any
   * upload) — a caught bot must see the same 200 shape a real submission
   * gets, and must not cost storage. Duplicate guard: one applicant per
   * `(tenant_id, intake_id, guardian_phone)` regardless of status — a
   * PENDING row is updated in place, anything else (SHORTLISTED/ADMITTED/
   * REJECTED) is a 409, matching the partial unique index on that triple.
   *
   * Uploads happen before the transaction (multer has already buffered
   * them), so a failure anywhere below — including inside the tx — must
   * delete every newly-written object; a successful in-place update must
   * delete whatever documents it replaced. Both cleanups are best-effort
   * (`Promise.allSettled`): a dangling object in storage is a cheap thing
   * to leave behind, but a delete failure must never mask the real error
   * or block a successful submission.
   */
  async submit(
    slug: string,
    dto: SubmitApplicantDto,
    files: Express.Multer.File[],
  ): Promise<{ reference_number: string; status: string }> {
    const school = await this.schoolsService.findBySlug(slug);
    if (!school) throw new NotFoundException('School not found');

    // Honeypot: return a plausible-looking success without persisting
    // anything, so a bot filling every visible field can't tell it was
    // caught — the reference number must look like a real one (same
    // format, current year, random code), not a recognizable constant a
    // bot could diff against a real response.
    if (dto.middle_name_confirm) {
      return {
        reference_number: this.randomReferenceCandidate(),
        status: AdmissionApplicantStatus.PENDING,
      };
    }

    const uploadedKeys: string[] = [];
    let replacedKeys: string[] = [];
    try {
      const documents = await this.uploadDocuments(school.id, files, uploadedKeys);

      // Seat-count check-then-write is a race under concurrent submissions
      // (D14 requires it hold) — a pessimistic row lock on the intake for the
      // duration of the transaction serializes submissions per intake so two
      // concurrent requests can't both read "seats left" and both insert.
      const result = await this.intakeRepo.manager.transaction(async (manager) => {
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
        if (intake.open_date > today) {
          throw new BadRequestException('This admission intake is not open yet');
        }
        if (intake.close_date < today) {
          throw new BadRequestException('This admission intake is closed');
        }

        // Compared normalized rather than with a raw exact match — the same
        // guardian typing "01700000001" on one visit and "+8801700000001"
        // on another must still hit the same row, or the duplicate guard
        // (and the unique index it backs) is trivially bypassed.
        //
        // ponytail: loads every applicant in the intake and compares in JS
        // rather than an indexed query on a canonical phone column — an
        // intake is seat-capped (seat_count is realistically tens to a few
        // hundred), so this is a small, lock-scoped read, not a table scan.
        // Upgrade to a generated/canonical phone column + index (with a
        // migration + backfill) if intakes ever grow large enough for this
        // to show up in profiling.
        const applicantRepo = manager.getRepository(AdmissionApplicant);
        const normalizedPhone = normalizeBdPhoneNumber(dto.guardian_phone);
        const candidates = await applicantRepo.find({
          where: { tenant_id: school.id, intake_id: intake.id },
        });
        const existing = candidates.find(
          (c) => normalizeBdPhoneNumber(c.guardian_phone) === normalizedPhone,
        );

        if (existing && existing.status !== AdmissionApplicantStatus.PENDING) {
          throw new ConflictException(
            'An application with this phone number has already been reviewed for this intake',
          );
        }

        // A phone number isn't secret and intake_id is public (returned by
        // GET /public/admission/:slug), so matching on those two alone
        // would let anyone overwrite someone else's pending application.
        // Updating an existing row requires proving ownership with the
        // reference_number the original submission got back.
        if (
          existing &&
          normalizeReferenceNumber(dto.reference_number ?? '') !== existing.reference_number
        ) {
          throw new ConflictException(
            'An application already exists for this phone number. Provide its reference number to update it.',
          );
        }

        // Merge by document type rather than replacing the whole list — a
        // resubmission that only re-uploads a photo must not drop an
        // earlier birth certificate.
        const newTypes = new Set(documents.map((d) => d.type));
        const kept = (existing?.documents ?? []).filter((d) => !newTypes.has(d.type));
        const merged = [...kept, ...documents];
        const missing = intake.required_document_types.filter(
          (type) => !merged.some((d) => d.type === type),
        );
        if (missing.length > 0) {
          throw new BadRequestException(`Missing required documents: ${missing.join(', ')}`);
        }

        if (existing) {
          replacedKeys = (existing.documents ?? [])
            .filter((d) => newTypes.has(d.type))
            .map((d) => d.storage_key);
          existing.applicant_name = dto.applicant_name;
          existing.date_of_birth = dto.date_of_birth;
          existing.gender = dto.gender;
          existing.guardian_name = dto.guardian_name;
          existing.guardian_email = dto.guardian_email ?? null;
          existing.home_address = dto.home_address ?? null;
          existing.documents = merged;
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

        const referenceNumber = await this.generateReferenceNumber(applicantRepo, school.id);
        const saved = await applicantRepo.save(
          applicantRepo.create({
            tenant_id: school.id,
            intake_id: intake.id,
            reference_number: referenceNumber,
            applicant_name: dto.applicant_name,
            date_of_birth: dto.date_of_birth,
            gender: dto.gender,
            guardian_name: dto.guardian_name,
            guardian_phone: dto.guardian_phone,
            guardian_email: dto.guardian_email ?? null,
            home_address: dto.home_address ?? null,
            documents: merged,
            status: AdmissionApplicantStatus.PENDING,
          }),
        );
        return { reference_number: saved.reference_number, status: saved.status };
      });

      if (replacedKeys.length > 0) {
        await Promise.allSettled(replacedKeys.map((key) => this.storage.delete(key)));
      }
      return result;
    } catch (err) {
      if (uploadedKeys.length > 0) {
        await Promise.allSettled(uploadedKeys.map((key) => this.storage.delete(key)));
      }
      throw err;
    }
  }

  private static readonly REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, no I/L/O/U
  private static readonly REFERENCE_CODE_LENGTH = 6;
  private static readonly REFERENCE_MAX_ATTEMPTS = 3;

  /** `ADM-<year>-<6 random chars>` per tenant. A SELECT-before-insert check
   * (not a raw insert-and-catch-23505) because a unique-violation would
   * abort the surrounding transaction with no savepoint to recover into —
   * a plain existence check never aborts anything, so it's safe to retry
   * inside the same tx. At 6 Crockford-base32 characters (~1.07 billion
   * codes per tenant per year) a real collision is astronomically rare;
   * three attempts is generous headroom, not a scheme that expects to need
   * them. `withDeleted` because the `(tenant_id, reference_number)` index
   * is not partial — a soft-deleted row's number still counts as taken. */
  private async generateReferenceNumber(
    applicantRepo: Repository<AdmissionApplicant>,
    tenantId: string,
  ): Promise<string> {
    for (let attempt = 0; attempt < AdmissionApplicantService.REFERENCE_MAX_ATTEMPTS; attempt++) {
      const candidate = this.randomReferenceCandidate();
      const taken = await applicantRepo.exists({
        where: { tenant_id: tenantId, reference_number: candidate },
        withDeleted: true,
      });
      if (!taken) return candidate;
    }
    throw new ConflictException('Please try again');
  }

  /** One `ADM-<year>-<6 random chars>` candidate, with no DB check — used
   * both by `generateReferenceNumber` (which does check) and the honeypot
   * path (which must return a real-looking value without touching the
   * database, so a bot can't tell it was caught by timing or a recognizable
   * constant). */
  private randomReferenceCandidate(): string {
    const year = new Date().getFullYear();
    const code = Array.from(
      { length: AdmissionApplicantService.REFERENCE_CODE_LENGTH },
      () =>
        AdmissionApplicantService.REFERENCE_ALPHABET[
          randomInt(AdmissionApplicantService.REFERENCE_ALPHABET.length)
        ],
    ).join('');
    return `ADM-${year}-${code}`;
  }

  private async uploadDocuments(
    tenantId: string,
    files: Express.Multer.File[],
    uploadedKeys: string[],
  ): Promise<AdmissionApplicantDocument[]> {
    // Validate every recognized file before writing any of them, so a bad
    // file never reaches storage and the caller never pays for an upload
    // that's about to be rejected.
    for (const file of files ?? []) {
      const type = documentTypeForFieldname(file.fieldname);
      if (!type) continue; // unrecognized field name — ignore rather than reject the whole submission
      const ext = EXT_BY_MIME[file.mimetype];
      if (!ext || !matchesDeclaredType(file.buffer, file.mimetype)) {
        throw new BadRequestException(
          `${file.fieldname}: file must be a PNG, JPEG, WEBP or PDF whose contents match its type`,
        );
      }
    }

    const documents: AdmissionApplicantDocument[] = [];
    for (const file of files ?? []) {
      const type = documentTypeForFieldname(file.fieldname);
      if (!type) continue;
      const ext = EXT_BY_MIME[file.mimetype];
      const key = tenantObjectKey(tenantId, 'admission-documents', ext);
      await this.storage.put(key, file.buffer, file.mimetype);
      uploadedKeys.push(key);
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

/** Forgives the handful of mistakes a guardian retyping a reference number
 * from an SMS is likely to make: stray case, and the letters the
 * Crockford-base32 alphabet deliberately excludes (O/I/L) mistyped for the
 * digits they're easy to confuse with. Safe because "ADM" itself contains
 * none of those letters. */
function normalizeReferenceNumber(raw: string): string {
  return raw.trim().toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
}
