import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  AuditAction,
  DocumentKind,
  Permission,
  PRINT_BATCH_CEILING,
  roleHasPermission,
} from '@biddaloy/shared';
import { PrintTemplate } from '../entities/print-template.entity';
import { PrintTemplateVersion } from '../entities/print-template-version.entity';
import { PrintJob } from '../entities/print-job.entity';
import { PrintJobItem } from '../entities/print-job-item.entity';
import { PrinterProfile } from '../entities/printer-profile.entity';
import { RESOLVERS, ResolvedSubject } from '../catalog/field-resolver';
import { generateSecret, hashSecret } from '../../auth/token-hash.util';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { todayInSchoolTz } from '../../../common/time';
import { CreatePrintJobDto, PreviewPrintJobDto } from './dto/print-job.dto';

export interface PrintCaller {
  tenantId: string;
  userId: string;
  role: string;
}

const photoUrl = (type: string, id: string, key: string | null) =>
  key
    ? `/print-jobs/photo?subject_type=${type}&subject_id=${id}&key=${encodeURIComponent(key)}`
    : null;

@Injectable()
export class PrintJobsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** D18: staff cards expose HR data, so the caller needs STAFF_HR_READ too. */
  private assertCanPrint(kind: DocumentKind, role: string) {
    if (kind === DocumentKind.STAFF_ID_CARD && !roleHasPermission(role, Permission.STAFF_HR_READ)) {
      throw new ForbiddenException('Missing permission: STAFF_HR_READ');
    }
  }

  /** Template + its published version, all scoped to the tenant. */
  private async loadTemplate(manager: EntityManager, caller: PrintCaller, dto: PreviewPrintJobDto) {
    const template = await manager.findOne(PrintTemplate, {
      where: { id: dto.template_id, tenant_id: caller.tenantId },
    });
    if (!template || template.archived_at) throw new NotFoundException('Template not found');
    const resolver = RESOLVERS[template.document_kind];
    if (!resolver || resolver.subjectType !== dto.subject_type) {
      throw new BadRequestException('subject_type does not match the template');
    }
    this.assertCanPrint(template.document_kind, caller.role);
    if (!template.current_version_id) {
      throw new ConflictException({
        message: 'Template has never been published',
        details: { code: 'NO_PUBLISHED_VERSION' },
      });
    }
    const ids = [...new Set(dto.subject_ids)];
    if (template.batch_size > PRINT_BATCH_CEILING) {
      throw new BadRequestException(
        `Template batch_size ${template.batch_size} exceeds the maximum of ${PRINT_BATCH_CEILING}`,
      );
    }
    if (ids.length > template.batch_size) {
      throw new BadRequestException(
        `${ids.length} subjects selected; this template allows at most ${template.batch_size} per job`,
      );
    }
    const version = await manager.findOneByOrFail(PrintTemplateVersion, {
      id: template.current_version_id,
      tenant_id: caller.tenantId,
    });
    const resolved = await resolver.resolve(caller.tenantId, ids, manager);
    // A subject from another tenant simply isn't returned — same as not existing.
    if (ids.some((id) => !resolved.has(id))) throw new NotFoundException('Subject not found');
    return { template, version, ids, resolved };
  }

  async preview(caller: PrintCaller, dto: PreviewPrintJobDto) {
    const { template, version, ids, resolved } = await this.loadTemplate(
      this.ds.manager,
      caller,
      dto,
    );
    return {
      template: {
        id: template.id,
        batch_size: template.batch_size,
        version: { id: version.id, version: version.version, definition: version.definition },
      },
      items: ids.map((id) => {
        const r = resolved.get(id) as ResolvedSubject;
        return {
          subject_id: id,
          label: r.label,
          values: r.values,
          photo_url: photoUrl(dto.subject_type, id, r.photoKey),
        };
      }),
    };
  }

  /**
   * One transaction: job + items (copy numbers, token hashes, frozen snapshot)
   * commit BEFORE the caller gets anything to render. The raw token is only
   * ever in this return value.
   */
  async create(caller: PrintCaller, dto: CreatePrintJobDto) {
    return this.ds.transaction(async (manager) => {
      const { template, version, ids, resolved } = await this.loadTemplate(manager, caller, dto);

      let printerName: string | null = null;
      if (dto.printer_profile_id) {
        const profile = await manager.findOne(PrinterProfile, {
          where: { id: dto.printer_profile_id, tenant_id: caller.tenantId },
        });
        if (!profile) throw new NotFoundException('Printer profile not found');
        printerName = profile.name;
      }

      const job = await manager.save(
        manager.create(PrintJob, {
          tenant_id: caller.tenantId,
          template_version_id: version.id,
          document_kind: template.document_kind,
          printer_profile_id: dto.printer_profile_id ?? null,
          printer_name: printerName,
          printed_by: caller.userId,
          item_count: ids.length,
          status: 'OPEN',
          batch_label: dto.batch_label ?? null,
        }),
      );

      const issuedAt = new Date().toISOString();
      const items: Array<Record<string, unknown>> = [];
      // Sorted ids => every concurrent job takes locks in the same order (no deadlock).
      for (const id of [...ids].sort()) {
        const r = resolved.get(id) as ResolvedSubject;
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `${caller.tenantId}:${dto.subject_type}:${id}:${template.document_kind}`,
        ]);
        const [{ n }] = await manager.query(
          `SELECT coalesce(max(copy_number), 0) + 1 AS n FROM print_job_items
            WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3 AND document_kind = $4`,
          [caller.tenantId, dto.subject_type, id, template.document_kind],
        );
        const copyNumber = Number(n);
        const token = generateSecret();
        const verifyUrl = `/v/${token}`;
        const values = {
          ...r.values,
          'print.copyLabel': `Copy ${copyNumber}`,
          'print.issue_date': todayInSchoolTz(),
          'print.verify_qr': verifyUrl,
        };
        const item = await manager.save(
          manager.create(PrintJobItem, {
            tenant_id: caller.tenantId,
            job_id: job.id,
            document_kind: template.document_kind,
            subject_type: dto.subject_type,
            subject_id: id,
            subject_label: r.label.slice(0, 200),
            copy_number: copyNumber,
            // The token itself is deliberately not part of the snapshot.
            data_snapshot: {
              values: { ...values, 'print.verify_qr': '' },
              photoKey: r.photoKey,
              copyNumber,
              issuedAt,
            },
            verify_token_hash: hashSecret(token),
          }),
        );
        await this.audit.record(
          {
            action: AuditAction.CREATE,
            entity_type: 'PrintJobItem',
            entity_id: item.id,
            tenant_id: caller.tenantId,
            performed_by_user_id: caller.userId,
            new_values: { job_id: job.id, subject_id: id, copy_number: copyNumber },
          },
          manager,
        );
        items.push({
          item_id: item.id,
          subject_id: id,
          label: r.label,
          values,
          copy_number: copyNumber,
          verify_url: verifyUrl,
          photo_url: photoUrl(dto.subject_type, id, r.photoKey),
        });
      }
      return {
        job_id: job.id,
        items,
        version: { id: version.id, definition: version.definition },
      };
    });
  }

  /** Stream a subject photo. Old keys stay valid (snapshots reference them, D48). */
  async photo(caller: PrintCaller, type: 'STUDENT' | 'STAFF', subjectId: string, key: string) {
    const kind = type === 'STAFF' ? DocumentKind.STAFF_ID_CARD : DocumentKind.STUDENT_ID_CARD;
    this.assertCanPrint(kind, caller.role);
    if (!key.startsWith(`tenants/${caller.tenantId}/`) || key.includes('..')) {
      throw new ForbiddenException('Invalid photo key');
    }
    const found = await RESOLVERS[kind].resolve(caller.tenantId, [subjectId], this.ds.manager);
    const subject = found.get(subjectId);
    if (!subject) throw new NotFoundException('Subject not found');
    // The key must be the subject's current photo, or one a job snapshot froze for them.
    if (key !== subject.photoKey) {
      const rows = await this.ds.query(
        `SELECT 1 FROM print_job_items
          WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3
            AND data_snapshot->>'photoKey' = $4 LIMIT 1`,
        [caller.tenantId, type, subjectId, key],
      );
      if (rows.length === 0) throw new NotFoundException('Photo not found');
    }
    return this.storage.get(key);
  }
}
