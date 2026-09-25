import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ApplicantReviewService } from './applicant-review.service';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionEvaluation } from './entities/admission-evaluation.entity';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { StudentService, GuardianService } from '../students/students.service';
import { AdmissionApplicantStatus } from '@biddaloy/shared';

/**
 * Unit-level coverage. What this spec covers vs a full e2e:
 * - COVERS: tenant-scoped repo queries on every path (`findOne`/`update`
 *   called with `tenant_id`), status-machine transitions, admit's guardian
 *   reuse-by-phone vs create, the ADMITTED-is-immutable guard.
 * - DOES NOT COVER: the `@Roles`/`@RequirePermissions` guard chain actually
 *   rejecting a non-ADMIN/non-ADMISSION_REVIEW caller with an HTTP 403 —
 *   that's exercised by `permission-matrix.e2e-spec.ts` and the shared
 *   `AdmissionApplicantStatus`) grant table in `permissions.spec.ts`
 *   (`ADMISSION_REVIEW` is ADMIN-only), not re-tested per-module here.
 */

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const REVIEWER = 'reviewer-1';

function makeApplicant(overrides: Partial<AdmissionApplicant> = {}): AdmissionApplicant {
  return {
    id: 'applicant-1',
    tenant_id: TENANT_A,
    intake_id: 'intake-1',
    reference_number: 'REF-1',
    applicant_name: 'Rahim Uddin',
    date_of_birth: '2015-01-01',
    gender: 'MALE',
    guardian_name: 'Karim Uddin',
    guardian_phone: '01700000000',
    guardian_email: null,
    home_address: null,
    documents: [],
    status: AdmissionApplicantStatus.PENDING,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    ...overrides,
  } as AdmissionApplicant;
}

describe('ApplicantReviewService', () => {
  let service: ApplicantReviewService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock repo shape (incl. `manager.transaction`) doesn't match `Record<string, Mock>`
  let applicantRepo: any;
  let evaluationRepo: Record<string, ReturnType<typeof vi.fn>>;
  let intakeRepo: Record<string, ReturnType<typeof vi.fn>>;
  let studentService: { create: ReturnType<typeof vi.fn> };
  let guardianService: { findByPhone: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    applicantRepo = {
      findOne: vi.fn(),
      update: vi.fn(),
      find: vi.fn(),
      manager: {
        transaction: vi.fn(async (cb: (manager: unknown) => Promise<unknown>) =>
          cb({
            getRepository: (entity: unknown) => {
              if (entity === AdmissionEvaluation) return evaluationRepo;
              if (entity === AdmissionApplicant) return applicantRepo;
              if (entity === AdmissionIntake) return intakeRepo;
              throw new Error('unexpected entity');
            },
          }),
        ),
      },
    };
    evaluationRepo = { create: vi.fn((dto) => dto), save: vi.fn(async (e) => e), find: vi.fn() };
    intakeRepo = {
      findOne: vi.fn(async () => ({ id: 'intake-1', class_section_id: 'section-1' })),
    };
    studentService = { create: vi.fn(async () => ({ id: 'student-1' })) };
    guardianService = { findByPhone: vi.fn(), create: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ApplicantReviewService,
        { provide: getRepositoryToken(AdmissionApplicant), useValue: applicantRepo },
        { provide: getRepositoryToken(AdmissionEvaluation), useValue: evaluationRepo },
        { provide: StudentService, useValue: studentService },
        { provide: GuardianService, useValue: guardianService },
      ],
    }).compile();

    service = moduleRef.get(ApplicantReviewService);
  });

  describe('evaluate', () => {
    it('shortlists on decision SHORTLIST', async () => {
      applicantRepo.findOne
        .mockResolvedValueOnce(makeApplicant())
        .mockResolvedValueOnce(makeApplicant({ status: AdmissionApplicantStatus.SHORTLISTED }));

      const result = await service.evaluate(
        'applicant-1',
        { notes: 'Looks good', decision: 'SHORTLIST' },
        TENANT_A,
        REVIEWER,
      );

      expect(evaluationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: TENANT_A,
          reviewer_user_id: REVIEWER,
          decision: 'SHORTLIST',
        }),
      );
      expect(applicantRepo.update).toHaveBeenCalledWith(
        { id: 'applicant-1', tenant_id: TENANT_A },
        { status: AdmissionApplicantStatus.SHORTLISTED },
      );
      expect(result.status).toBe(AdmissionApplicantStatus.SHORTLISTED);
    });

    it('rejects on decision REJECT', async () => {
      applicantRepo.findOne
        .mockResolvedValueOnce(makeApplicant())
        .mockResolvedValueOnce(makeApplicant({ status: AdmissionApplicantStatus.REJECTED }));

      await service.evaluate(
        'applicant-1',
        { notes: 'Not a fit', decision: 'REJECT' },
        TENANT_A,
        REVIEWER,
      );

      expect(applicantRepo.update).toHaveBeenCalledWith(
        { id: 'applicant-1', tenant_id: TENANT_A },
        { status: AdmissionApplicantStatus.REJECTED },
      );
    });

    it('rejects decision ADMIT — must go through admit()', async () => {
      applicantRepo.findOne.mockResolvedValueOnce(makeApplicant());
      await expect(
        service.evaluate('applicant-1', { notes: 'x', decision: 'ADMIT' }, TENANT_A, REVIEWER),
      ).rejects.toThrow(BadRequestException);
      expect(evaluationRepo.save).not.toHaveBeenCalled();
    });

    it('blocks evaluate once ADMITTED', async () => {
      applicantRepo.findOne.mockResolvedValueOnce(
        makeApplicant({ status: AdmissionApplicantStatus.ADMITTED }),
      );
      await expect(
        service.evaluate('applicant-1', { notes: 'x' }, TENANT_A, REVIEWER),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects evaluate for an applicant in a different tenant', async () => {
      applicantRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.evaluate('applicant-1', { notes: 'x' }, TENANT_B, REVIEWER),
      ).rejects.toThrow(NotFoundException);
      expect(applicantRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenant_id: TENANT_B }) }),
      );
    });
  });

  describe('admit', () => {
    it('creates exactly one student and reuses an existing guardian by phone', async () => {
      applicantRepo.findOne
        .mockResolvedValueOnce(makeApplicant({ status: AdmissionApplicantStatus.SHORTLISTED }))
        .mockResolvedValueOnce(makeApplicant({ status: AdmissionApplicantStatus.ADMITTED }));
      guardianService.findByPhone.mockResolvedValueOnce({ id: 'guardian-existing' });

      await service.admit('applicant-1', {}, TENANT_A, REVIEWER);

      expect(guardianService.findByPhone).toHaveBeenCalledWith(
        '01700000000',
        TENANT_A,
        expect.anything(),
      );
      expect(guardianService.create).not.toHaveBeenCalled();
      expect(studentService.create).toHaveBeenCalledTimes(1);
      expect(studentService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          guardian_ids: ['guardian-existing'],
          class_section_id: 'section-1',
        }),
        TENANT_A,
        expect.anything(),
      );
      expect(applicantRepo.update).toHaveBeenCalledWith(
        { id: 'applicant-1', tenant_id: TENANT_A },
        { status: AdmissionApplicantStatus.ADMITTED },
      );
    });

    it('creates a new guardian when the phone does not match an existing one', async () => {
      applicantRepo.findOne
        .mockResolvedValueOnce(makeApplicant())
        .mockResolvedValueOnce(makeApplicant({ status: AdmissionApplicantStatus.ADMITTED }));
      guardianService.findByPhone.mockResolvedValueOnce(null);
      guardianService.create.mockResolvedValueOnce({ id: 'guardian-new' });

      await service.admit('applicant-1', {}, TENANT_A, REVIEWER);

      expect(guardianService.create).toHaveBeenCalledWith(
        { full_name: 'Karim Uddin', phone: '01700000000', email: undefined },
        TENANT_A,
        expect.anything(),
        REVIEWER,
      );
      expect(studentService.create).toHaveBeenCalledWith(
        expect.objectContaining({ guardian_ids: ['guardian-new'] }),
        TENANT_A,
        expect.anything(),
      );
    });

    it('blocks admit once already ADMITTED', async () => {
      applicantRepo.findOne.mockResolvedValueOnce(
        makeApplicant({ status: AdmissionApplicantStatus.ADMITTED }),
      );
      await expect(service.admit('applicant-1', {}, TENANT_A, REVIEWER)).rejects.toThrow(
        ConflictException,
      );
      expect(studentService.create).not.toHaveBeenCalled();
    });

    it('blocks admit from REJECTED', async () => {
      applicantRepo.findOne.mockResolvedValueOnce(
        makeApplicant({ status: AdmissionApplicantStatus.REJECTED }),
      );
      await expect(service.admit('applicant-1', {}, TENANT_A, REVIEWER)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('reject', () => {
    it('rejects a PENDING applicant with no student created', async () => {
      applicantRepo.findOne
        .mockResolvedValueOnce(makeApplicant())
        .mockResolvedValueOnce(makeApplicant({ status: AdmissionApplicantStatus.REJECTED }));

      const result = await service.reject('applicant-1', TENANT_A, REVIEWER, 'No seats');

      expect(studentService.create).not.toHaveBeenCalled();
      expect(applicantRepo.update).toHaveBeenCalledWith(
        { id: 'applicant-1', tenant_id: TENANT_A },
        { status: AdmissionApplicantStatus.REJECTED },
      );
      expect(result.status).toBe(AdmissionApplicantStatus.REJECTED);
    });

    it('blocks reject once already ADMITTED', async () => {
      applicantRepo.findOne.mockResolvedValueOnce(
        makeApplicant({ status: AdmissionApplicantStatus.ADMITTED }),
      );
      await expect(service.reject('applicant-1', TENANT_A, REVIEWER)).rejects.toThrow(
        ConflictException,
      );
    });

    it('blocks re-rejecting an already-REJECTED applicant', async () => {
      applicantRepo.findOne.mockResolvedValueOnce(
        makeApplicant({ status: AdmissionApplicantStatus.REJECTED }),
      );
      await expect(service.reject('applicant-1', TENANT_A, REVIEWER)).rejects.toThrow(
        ConflictException,
      );
      expect(evaluationRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('scopes to tenant and passes through intake/status filters', async () => {
      applicantRepo.find.mockResolvedValueOnce([makeApplicant()]);

      await service.list(TENANT_A, {
        intakeId: 'intake-1',
        status: AdmissionApplicantStatus.SHORTLISTED,
      });

      expect(applicantRepo.find).toHaveBeenCalledWith({
        where: {
          tenant_id: TENANT_A,
          deleted_at: expect.anything(),
          intake_id: 'intake-1',
          status: AdmissionApplicantStatus.SHORTLISTED,
        },
        order: { created_at: 'DESC' },
      });
    });

    it('does not leak a tenant-B applicant into tenant-A results', async () => {
      applicantRepo.find.mockResolvedValueOnce([]);

      const result = await service.list(TENANT_A, {});

      expect(applicantRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenant_id: TENANT_A }) }),
      );
      expect(result).toEqual([]);
    });
  });

  describe('findWithHistory', () => {
    it('returns the applicant plus its evaluation history, tenant-scoped', async () => {
      applicantRepo.findOne.mockResolvedValueOnce(makeApplicant());
      evaluationRepo.find.mockResolvedValueOnce([
        {
          id: 'eval-1',
          reviewer_user_id: REVIEWER,
          notes: 'Looks good',
          decision: 'SHORTLIST',
          created_at: new Date(),
        },
      ]);

      const result = await service.findWithHistory('applicant-1', TENANT_A);

      expect(evaluationRepo.find).toHaveBeenCalledWith({
        where: { applicant_id: 'applicant-1', tenant_id: TENANT_A },
        order: { created_at: 'DESC' },
      });
      expect(result.applicant.id).toBe('applicant-1');
      expect(result.evaluations).toHaveLength(1);
    });

    it('404s for an applicant in a different tenant', async () => {
      applicantRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.findWithHistory('applicant-1', TENANT_B)).rejects.toThrow(
        NotFoundException,
      );
      expect(evaluationRepo.find).not.toHaveBeenCalled();
    });
  });
});
