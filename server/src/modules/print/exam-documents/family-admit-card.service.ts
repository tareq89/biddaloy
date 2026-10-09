import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DocumentKind, isGuardianRole } from '@biddaloy/shared';
import { FeeDuesService } from '../../fees/fee-dues.service';
import { SchoolSettingsReader } from '../../schools/settings/school-settings-reader.service';
import { PrintAssetsService, assetIdsOf } from '../assets/print-assets.service';
import { PrintJobsService } from '../jobs/print-jobs.service';
import { CreatePrintJobDto } from '../jobs/dto/print-job.dto';

/** [48.2.09] A linked PARENT/STUDENT prints their own admit card. Every query is tenant-scoped. */
@Injectable()
export class FamilyAdmitCardService {
  constructor(
    private readonly ds: DataSource,
    private readonly jobs: PrintJobsService,
    private readonly feeDues: FeeDuesService,
    private readonly settings: SchoolSettingsReader,
    private readonly assets: PrintAssetsService,
  ) {}

  /** Guardian role + the student sits this exam with a published seat. Shared by print and file reads. */
  private async assertAvailable(
    tenant: { id: string; role: string },
    studentId: string,
    examId: string,
  ) {
    // D42: families only. assertLinked is a no-op for staff and `family: true` skips the
    // print-permission check, so without this a TEACHER (RESULT_READ) could print here.
    if (!isGuardianRole(tenant.role)) {
      throw new ForbiddenException({
        message: 'Staff print admit cards from the exam page',
        details: { code: 'FAMILY_ONLY' },
      });
    }

    // Available = a seat in a PUBLISHED seat plan for this exam (same signal as the to-print queue).
    const [seat] = await this.ds.query(
      `SELECT 1 FROM seat_allocations sa
       JOIN seat_plans sp ON sp.id = sa.seat_plan_id AND sp.tenant_id = sa.tenant_id
       JOIN exam_schedules es ON es.id = sa.exam_schedule_id AND es.tenant_id = sa.tenant_id
       JOIN exams e ON e.id = es.exam_id AND e.tenant_id = es.tenant_id
       WHERE sa.tenant_id = $1 AND sa.student_id = $2 AND es.exam_id = $3
         AND sp.status = 'PUBLISHED' AND sp.deleted_at IS NULL
         AND es.deleted_at IS NULL AND e.deleted_at IS NULL
       LIMIT 1`,
      [tenant.id, studentId, examId],
    );
    if (!seat) throw new NotFoundException('Admit card not available');
  }

  /** The default admit-card template's current version definition, or null. */
  private async defaultDefinition(tenantId: string): Promise<unknown | null> {
    const [row] = await this.ds.query(
      `SELECT v.definition FROM print_templates t
       JOIN print_template_versions v ON v.id = t.current_version_id AND v.tenant_id = t.tenant_id
       WHERE t.tenant_id = $1 AND t.document_kind = $2 AND t.is_default = true
         AND t.archived_at IS NULL
       LIMIT 1`,
      [tenantId, DocumentKind.EXAM_ADMIT_CARD],
    );
    return row?.definition ?? null;
  }

  /** Artwork/font bytes of the default admit card; only ids its current version uses (else 404). */
  async assetFile(
    tenant: { id: string; role: string },
    studentId: string,
    examId: string,
    assetId: string,
  ) {
    await this.assertAvailable(tenant, studentId, examId);
    const definition = await this.defaultDefinition(tenant.id);
    if (!definition || !assetIdsOf(definition).has(assetId)) {
      throw new NotFoundException('Print asset not found');
    }
    return this.assets.getFile(assetId, tenant.id);
  }

  /** Caller must already have passed `FamilyAccessService.assertLinked`. */
  async print(
    tenant: { id: string; role: string },
    userId: string,
    studentId: string,
    examId: string,
  ) {
    await this.assertAvailable(tenant, studentId, examId);

    // D9: the dues check only runs (and fee data is only read) when the school withholds.
    if ((await this.settings.documentsSettings(tenant.id)).withholdAdmitCardForDues === true) {
      const dues = await this.feeDues.getDueSnapshots([studentId], tenant.id);
      if ((dues.get(studentId)?.total_due ?? 0) > 0) {
        throw new ConflictException({
          message: 'Admit card withheld. Please contact the school.',
          details: { code: 'ADMIT_CARD_WITHHELD' },
        });
      }
    }

    // Resolved by kind, never from client input.
    const [tpl] = await this.ds.query(
      `SELECT id FROM print_templates
       WHERE tenant_id = $1 AND document_kind = $2 AND is_default = true
         AND archived_at IS NULL AND current_version_id IS NOT NULL
       LIMIT 1`,
      [tenant.id, DocumentKind.EXAM_ADMIT_CARD],
    );
    if (!tpl) {
      throw new ConflictException({
        message: 'The school has not set up an admit card yet',
        details: { code: 'NO_ADMIT_CARD_TEMPLATE' },
      });
    }

    const res = await this.jobs.create(
      { tenantId: tenant.id, userId, role: tenant.role },
      {
        template_id: tpl.id,
        subject_type: 'STUDENT',
        subject_ids: [studentId],
        context_type: 'EXAM',
        context_id: examId,
        batch_label: 'portal',
      } as CreatePrintJobDto,
      { family: true },
    );
    // The staff photo route needs DOCUMENT_PRINT; families read the student photo route instead.
    return {
      ...res,
      items: res.items.map((i) => ({
        ...i,
        photo_url: i.photo_url ? `/students/${i.subject_id}/photo` : null,
      })),
    };
  }
}
