import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  AuditAction,
  DocumentKind,
  FIELD_CATALOG,
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
    // ACR is confidential: DOCUMENT_PRINT alone (ACCOUNTANT) is not enough.
    if (kind === DocumentKind.ACR_ASSESSMENT && !roleHasPermission(role, Permission.ACR_READ)) {
      throw new ForbiddenException('Missing permission: ACR_READ');
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
    const resolved = await resolver.resolve(caller.tenantId, ids, manager, caller.userId);
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
      const issueDate = todayInSchoolTz();
      const items: Array<Record<string, unknown>> = [];
      // Sorted ids => every concurrent job takes locks in the same order (no deadlock).
      for (const id of [...ids].sort()) {
        const r = resolved.get(id) as ResolvedSubject;
        items.push(
          await this.insertItem(manager, caller, job.id, {
            kind: template.document_kind,
            subjectType: dto.subject_type,
            subjectId: id,
            label: r.label,
            baseValues: r.values,
            photoKey: r.photoKey,
            issuedAt,
            issueDate,
          }),
        );
      }
      return {
        job_id: job.id,
        items,
        version: { id: version.id, definition: version.definition },
      };
    });
  }

  /** The job's printer, or an ADMIN, may close it out. */
  private assertCanManageJob(caller: PrintCaller, job: PrintJob) {
    if (job.printed_by !== caller.userId && caller.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Only the person who printed this job, or an admin, can do this',
      );
    }
  }

  /** D25: "Did all N print correctly?" — everything OK except the ticked items. */
  async confirm(caller: PrintCaller, jobId: string, failedItemIds: string[]) {
    return this.ds.transaction(async (manager) => {
      const job = await manager.findOne(PrintJob, {
        where: { id: jobId, tenant_id: caller.tenantId },
      });
      if (!job) throw new NotFoundException('Print job not found');
      this.assertCanManageJob(caller, job);
      this.assertCanPrint(job.document_kind, caller.role);

      const failed = [...new Set(failedItemIds)];
      const items = await manager.find(PrintJobItem, {
        select: { id: true },
        where: { job_id: job.id, tenant_id: caller.tenantId },
      });
      const known = new Set(items.map((i) => i.id));
      if (failed.some((id) => !known.has(id))) {
        throw new BadRequestException('failed_item_ids must belong to this job');
      }

      // Conditional update = the double-confirm guard: only one caller flips OPEN -> CONFIRMED.
      const flipped = await manager.update(
        PrintJob,
        { id: job.id, tenant_id: caller.tenantId, status: 'OPEN' },
        { status: 'CONFIRMED', confirmed_at: new Date() },
      );
      if (flipped.affected !== 1) throw new ConflictException('This job is already confirmed');

      await manager.update(
        PrintJobItem,
        { job_id: job.id, tenant_id: caller.tenantId },
        { outcome: 'OK' },
      );
      if (failed.length) {
        await manager.update(
          PrintJobItem,
          { job_id: job.id, tenant_id: caller.tenantId, id: In(failed) },
          { outcome: 'FAILED' },
        );
      }
      return { job_id: job.id, status: 'CONFIRMED' as const, failed_item_ids: failed };
    });
  }

  /**
   * D59: a reprint is a NEW job on the SAME template version with the SAME frozen
   * snapshot values and photo — only the copy number and verify token are new.
   */
  async reprint(caller: PrintCaller, jobId: string, itemIds: string[]) {
    return this.ds.transaction(async (manager) => {
      const original = await manager.findOne(PrintJob, {
        where: { id: jobId, tenant_id: caller.tenantId },
      });
      if (!original) throw new NotFoundException('Print job not found');
      this.assertCanPrint(original.document_kind, caller.role);

      const ids = [...new Set(itemIds)];
      const originals = await manager.find(PrintJobItem, {
        where: { id: In(ids), job_id: original.id, tenant_id: caller.tenantId },
      });
      if (originals.length !== ids.length) throw new NotFoundException('Print item not found');
      if (originals.some((i) => i.revoked_at)) {
        throw new ConflictException('A revoked document cannot be reprinted');
      }
      if (originals.some((i) => !i.subject_id)) {
        throw new BadRequestException('This item has no subject to reprint');
      }
      // ACR: re-check the subject now (own ACR -> 404, reopened -> 409); a snapshot never outlives that.
      if (original.document_kind === DocumentKind.ACR_ASSESSMENT) {
        const subjectIds = originals.map((i) => i.subject_id as string);
        const found = await RESOLVERS[original.document_kind].resolve(
          caller.tenantId,
          subjectIds,
          manager,
          caller.userId,
        );
        if (subjectIds.some((id) => !found.has(id)))
          throw new NotFoundException('Subject not found');
        // A snapshot records what was printed; if the ACR was re-completed since, it is stale.
        const done: Array<{ id: string; completed_at: Date | null }> = await manager.query(
          `SELECT id, completed_at FROM acr_assessments WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [caller.tenantId, subjectIds],
        );
        const completedAt = new Map(done.map((d) => [d.id, d.completed_at]));
        for (const o of originals) {
          const at = completedAt.get(o.subject_id as string);
          const issued = (o.data_snapshot as { issuedAt: string }).issuedAt;
          if (!at || at.getTime() > new Date(issued).getTime()) {
            throw new ConflictException('This ACR changed after it was printed. Print it again.');
          }
        }
      }
      const version = await manager.findOneByOrFail(PrintTemplateVersion, {
        id: original.template_version_id,
        tenant_id: caller.tenantId,
      });

      const job = await manager.save(
        manager.create(PrintJob, {
          tenant_id: caller.tenantId,
          template_version_id: original.template_version_id,
          document_kind: original.document_kind,
          printer_profile_id: original.printer_profile_id,
          printer_name: original.printer_name,
          printed_by: caller.userId,
          item_count: originals.length,
          status: 'OPEN',
          batch_label: original.batch_label,
          reprint_of_job_id: original.id,
        }),
      );

      const items: Array<Record<string, unknown>> = [];
      // Sorted by subject => same lock order as create (no deadlock).
      for (const o of [...originals].sort((a, b) =>
        (a.subject_id as string).localeCompare(b.subject_id as string),
      )) {
        const snap = o.data_snapshot as {
          values: Record<string, unknown>;
          photoKey: string | null;
          issuedAt: string;
        };
        // Everything the original printed stays; only the three per-copy keys are re-minted.
        const {
          'print.copyLabel': _label,
          'print.issue_date': issueDate,
          'print.verify_qr': _qr,
          ...baseValues
        } = snap.values;
        items.push(
          await this.insertItem(manager, caller, job.id, {
            kind: o.document_kind,
            subjectType: o.subject_type,
            subjectId: o.subject_id as string,
            label: o.subject_label,
            baseValues,
            photoKey: snap.photoKey,
            issuedAt: snap.issuedAt,
            issueDate: String(issueDate),
          }),
        );
      }
      return { job_id: job.id, items, version: { id: version.id, definition: version.definition } };
    });
  }

  /**
   * Shared by create and reprint: take the per-(tenant, subject, kind) lock,
   * assign the next copy number under it, mint the verify token, freeze the
   * snapshot, audit. The raw token only ever appears in the returned item.
   */
  private async insertItem(
    manager: EntityManager,
    caller: PrintCaller,
    jobId: string,
    s: {
      kind: DocumentKind;
      subjectType: 'STUDENT' | 'STAFF' | 'ACR';
      subjectId: string;
      label: string;
      baseValues: Record<string, unknown>;
      photoKey: string | null;
      issuedAt: string;
      issueDate: string;
    },
  ) {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `${caller.tenantId}:${s.subjectType}:${s.subjectId}:${s.kind}`,
    ]);
    const [{ n }] = await manager.query(
      `SELECT coalesce(max(copy_number), 0) + 1 AS n FROM print_job_items
        WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3 AND document_kind = $4`,
      [caller.tenantId, s.subjectType, s.subjectId, s.kind],
    );
    const copyNumber = Number(n);
    const token = generateSecret();
    // Confidential kinds (ACR) have no verify QR: no URL is handed out, so the stored hash
    // belongs to a token nobody holds.
    const verifiable = FIELD_CATALOG[s.kind].some((f) => f.key === 'print.verify_qr');
    const verifyUrl = verifiable ? `/v/${token}` : undefined;
    const values: Record<string, unknown> = {
      ...s.baseValues,
      'print.copyLabel': `Copy ${copyNumber}`,
      'print.issue_date': s.issueDate,
      ...(verifyUrl ? { 'print.verify_qr': verifyUrl } : {}),
    };
    const item = await manager.save(
      manager.create(PrintJobItem, {
        tenant_id: caller.tenantId,
        job_id: jobId,
        document_kind: s.kind,
        subject_type: s.subjectType,
        subject_id: s.subjectId,
        subject_label: s.label.slice(0, 200),
        copy_number: copyNumber,
        // The token itself is deliberately not part of the snapshot.
        data_snapshot: {
          values: verifiable ? { ...values, 'print.verify_qr': '' } : values,
          photoKey: s.photoKey,
          copyNumber,
          issuedAt: s.issuedAt,
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
        new_values: { job_id: jobId, subject_id: s.subjectId, copy_number: copyNumber },
      },
      manager,
    );
    return {
      item_id: item.id,
      subject_id: s.subjectId,
      label: s.label,
      values,
      copy_number: copyNumber,
      verify_url: verifyUrl,
      photo_url: photoUrl(s.subjectType, s.subjectId, s.photoKey),
    };
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
