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
  formatSerial,
  isSerialKind,
  isStudentCertificateKind,
  TemplateDefinition,
  validateIssueValues,
  KIND_CONTEXT,
  Permission,
  PRINT_BATCH_CEILING,
  roleHasPermission,
} from '@biddaloy/shared';
import { PrintTemplate } from '../entities/print-template.entity';
import { PrintTemplateVersion } from '../entities/print-template-version.entity';
import { PrintJob } from '../entities/print-job.entity';
import { PrintJobItem } from '../entities/print-job-item.entity';
import { PrinterProfile } from '../entities/printer-profile.entity';
import { PrintContext, RESOLVERS, ResolvedSubject, resolverFor } from '../catalog/field-resolver';
import { generateSecret, hashSecret } from '../../auth/token-hash.util';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { todayInSchoolTz } from '../../../common/time';
import { SchoolSettingsReader } from '../../schools/settings/school-settings-reader.service';
import { CreatePrintJobDto, PreviewPrintJobDto } from './dto/print-job.dto';

export interface PrintCaller {
  tenantId: string;
  userId: string;
  role: string;
  /** Set by `CertificatesController` (CERTIFICATE_ISSUE routes); absent on the DOCUMENT_PRINT routes. */
  channel?: 'CERTIFICATE';
}

const photoUrl = (type: string, id: string, key: string | null, channel?: 'CERTIFICATE') =>
  key
    ? `${channel ? '/certificates' : '/print-jobs'}/photo?subject_type=${type}&subject_id=${id}&key=${encodeURIComponent(key)}`
    : null;

/** Kinds a `{ family: true }` caller may print. Add a kind only together with its own portal route. */
const FAMILY_KINDS: DocumentKind[] = [DocumentKind.EXAM_ADMIT_CARD];

const DEFAULT_SERIAL_COPY_LABEL = 'প্রতিলিপি / DUPLICATE (copy {n})';

@Injectable()
export class PrintJobsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly settings: SchoolSettingsReader,
  ) {}

  /**
   * D6/D40: the five student certificates are only issuable on the CERTIFICATE_ISSUE
   * routes (`channel`), everything else only on the DOCUMENT_PRINT routes.
   */
  private assertCanPrint(kind: DocumentKind, caller: PrintCaller) {
    const role = caller.role;
    const certificate = isStudentCertificateKind(kind);
    if (caller.channel === 'CERTIFICATE' && !certificate) {
      throw new BadRequestException('Not a certificate');
    }
    if (certificate && caller.channel !== 'CERTIFICATE') {
      throw new ForbiddenException(`Requires permission(s): ${Permission.CERTIFICATE_ISSUE}`);
    }
    if (kind === DocumentKind.STAFF_ID_CARD && !roleHasPermission(role, Permission.STAFF_HR_READ)) {
      throw new ForbiddenException('Missing permission: STAFF_HR_READ');
    }
    // ACR is confidential: DOCUMENT_PRINT alone (ACCOUNTANT) is not enough.
    if (kind === DocumentKind.ACR_ASSESSMENT && !roleHasPermission(role, Permission.ACR_READ)) {
      throw new ForbiddenException('Missing permission: ACR_READ');
    }
  }

  private assertFamilyKind(kind: DocumentKind) {
    if (!FAMILY_KINDS.includes(kind)) {
      throw new ForbiddenException('This document cannot be printed from the portal');
    }
  }

  /** Template + its published version, all scoped to the tenant. */
  private async loadTemplate(
    manager: EntityManager,
    caller: PrintCaller,
    dto: PreviewPrintJobDto,
    family = false,
    strict = false,
  ) {
    const template = await manager.findOne(PrintTemplate, {
      where: { id: dto.template_id, tenant_id: caller.tenantId },
    });
    if (!template || template.archived_at) throw new NotFoundException('Template not found');
    // Permission first, so a caller who may not print this kind learns nothing about the template.
    // A family caller has no staff role, so it gets an allow-list instead: a crafted template_id
    // for a staff card / ACR / certificate is a 403.
    if (family) this.assertFamilyKind(template.document_kind);
    else this.assertCanPrint(template.document_kind, caller);
    const resolver = RESOLVERS[template.document_kind];
    if (!resolver || resolver.subjectType !== dto.subject_type) {
      throw new BadRequestException('subject_type does not match the template');
    }
    // Context (the exam) is required exactly for the kinds that have one, refused for the rest.
    const wanted = KIND_CONTEXT[template.document_kind];
    let context: PrintContext | undefined;
    if (wanted) {
      if (dto.context_type !== wanted || !dto.context_id) {
        throw new BadRequestException(
          `${template.document_kind} needs context_type ${wanted} and context_id`,
        );
      }
      context = { type: wanted, id: dto.context_id };
    } else if (dto.context_type || dto.context_id) {
      throw new BadRequestException(`${template.document_kind} takes no context`);
    }
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
    // D3/D43: only the issue.* fields the template places, trimmed. Preview (not strict) accepts
    // a partial set: unknown / too-long keys still fail, missing ones fall back to the catalog sample.
    const issue: Record<string, string> = {};
    for (const [k, v] of Object.entries(dto.issue_values ?? {})) issue[k] = v.trim();
    const issueErrors = validateIssueValues(
      version.definition as TemplateDefinition,
      template.document_kind,
      issue,
      { partial: !strict },
    );
    if (issueErrors.length)
      throw new BadRequestException({
        statusCode: 400,
        message: issueErrors,
        error: 'Bad Request',
      });
    const resolved = await resolver.resolve(caller.tenantId, ids, manager, caller.userId, context);
    // A subject from another tenant simply isn't returned — same as not existing.
    if (ids.some((id) => !resolved.has(id))) throw new NotFoundException('Subject not found');
    return { template, version, ids, resolved, context, issue };
  }

  async preview(caller: PrintCaller, dto: PreviewPrintJobDto) {
    const { template, version, ids, resolved, issue } = await this.loadTemplate(
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
          values: { ...r.values, ...issue },
          photo_url: photoUrl(dto.subject_type, id, r.photoKey, caller.channel),
        };
      }),
    };
  }

  /**
   * One transaction: job + items (copy numbers, token hashes, frozen snapshot)
   * commit BEFORE the caller gets anything to render. The raw token is only
   * ever in this return value.
   */
  async create(caller: PrintCaller, dto: CreatePrintJobDto, opts?: { family?: true }) {
    const family = opts?.family === true;
    // Only serial kinds use the prefix. Read before the transaction so a settings lookup never
    // holds a connection open. A portal print is never a serial kind (FAMILY_KINDS), so it skips
    // the read; for staff the kind is only known from the template, and looking that up first
    // would cost the same one-row read.
    const docs: { serialPrefix?: string } = family
      ? {}
      : await this.settings.documentsSettings(caller.tenantId);
    return this.ds.transaction(async (manager) => {
      const { template, version, ids, resolved, context, issue } = await this.loadTemplate(
        manager,
        caller,
        dto,
        family,
        true,
      );

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
          status: family ? 'CONFIRMED' : 'OPEN',
          ...(family ? { confirmed_at: new Date() } : {}),
          batch_label: dto.batch_label ?? null,
        }),
      );

      const kind = template.document_kind;
      const issuedAt = new Date().toISOString();
      const issueDate = todayInSchoolTz();
      const serialKind = isSerialKind(kind);
      // D24: the Dhaka calendar year (issueDate is already Dhaka time).
      const year = Number(issueDate.slice(0, 4));
      let nextSerial = 0;
      if (serialKind) {
        // ONE lock for the whole job, taken before any item and held to commit: a bulk
        // job gets consecutive numbers and two clerks can never read the same max.
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `${caller.tenantId}:SERIAL:${kind}:${year}`,
        ]);
        const [{ n }] = await manager.query(
          `SELECT coalesce(max(serial_no), 0) + 1 AS n FROM print_job_items
            WHERE tenant_id = $1 AND document_kind = $2 AND serial_year = $3`,
          [caller.tenantId, kind, year],
        );
        nextSerial = Number(n);
      }
      const copyLabelText = (version.definition as { copyLabel?: { text?: string } })?.copyLabel
        ?.text;
      const items: Array<Record<string, unknown>> = [];
      // Serial kinds: request order (the client sends roll order). Others: sorted ids =>
      // every concurrent job takes subject locks in the same order (no deadlock).
      for (const id of serialKind ? ids : [...ids].sort()) {
        const r = resolved.get(id) as ResolvedSubject;
        let serial: { no: number; year: number; fresh: true } | undefined;
        let baseValues: Record<string, unknown> = { ...r.values, ...issue };
        if (serialKind) {
          serial = { no: nextSerial++, year, fresh: true };
          baseValues = {
            ...baseValues,
            'print.serial_no': this.serialText(docs.serialPrefix, kind, serial),
          };
        }
        items.push(
          await this.insertItem(manager, caller, job.id, {
            kind,
            subjectType: dto.subject_type,
            subjectId: id,
            label: r.label,
            baseValues,
            photoKey: r.photoKey,
            issuedAt,
            issueDate,
            context,
            serial,
            copyLabelText,
            issueKeys: Object.keys(issue),
            outcome: family ? 'OK' : undefined,
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

  private serialText(
    prefix: string | undefined,
    kind: DocumentKind,
    s: { no: number; year: number },
  ) {
    try {
      return formatSerial({ prefix, kind, year: s.year, n: s.no });
    } catch (e) {
      // Past 99999 in a year: refuse rather than print a malformed serial.
      if (e instanceof RangeError && s.no > 99999) {
        throw new ConflictException('Serial numbers for this year are exhausted');
      }
      throw e;
    }
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
      this.assertCanPrint(job.document_kind, caller);

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
      this.assertCanPrint(original.document_kind, caller);

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
        const found = await resolverFor(original.document_kind).resolve(
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
      // Serial items by serial then subject, the rest by subject => a stable lock order (no deadlock).
      const copyLabelText = (version.definition as { copyLabel?: { text?: string } })?.copyLabel
        ?.text;
      for (const o of [...originals].sort(
        (a, b) =>
          (a.serial_no ?? 0) - (b.serial_no ?? 0) ||
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
            // Subject, context and serial always come from the stored original, never the request.
            context: o.context_type
              ? { type: o.context_type, id: o.context_id as string }
              : undefined,
            serial:
              o.serial_no !== null && o.serial_year !== null
                ? { no: o.serial_no, year: o.serial_year }
                : undefined,
            copyLabelText,
            // Same audit shape as create: which issue-time fields this copy carries.
            issueKeys: Object.keys(baseValues).filter((k) => k.startsWith('issue.')),
          }),
        );
      }
      return { job_id: job.id, items, version: { id: version.id, definition: version.definition } };
    });
  }

  /**
   * Shared by create and reprint: take the lock, assign the next copy number under
   * it, mint the verify token, freeze the snapshot, audit. The raw token only ever
   * appears in the returned item.
   *
   * Copy numbers are keyed like the unique indexes (D41):
   *  - no serial: (tenant, subject, kind, context) under a per-subject lock;
   *  - serial, `fresh` (create): copy 1; `create` already holds the kind-year lock;
   *  - serial reprint: (tenant, kind, year, serial_no) under a per-serial lock, and
   *    every stored copy of that serial must belong to this same student/context.
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
      context?: PrintContext;
      serial?: { no: number; year: number; fresh?: true };
      copyLabelText?: string;
      issueKeys?: string[];
      outcome?: 'OK';
    },
  ) {
    const ctxType = s.context?.type ?? null;
    const ctxId = s.context?.id ?? null;
    let copyNumber = 1;
    if (s.serial && !s.serial.fresh) {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `${caller.tenantId}:SERIAL:${s.kind}:${s.serial.year}:${s.serial.no}`,
      ]);
      const rows: Array<{
        subject_type: string;
        subject_id: string | null;
        context_type: string | null;
        context_id: string | null;
        copy_number: number;
      }> = await manager.query(
        `SELECT subject_type, subject_id, context_type, context_id, copy_number FROM print_job_items
          WHERE tenant_id = $1 AND document_kind = $2 AND serial_year = $3 AND serial_no = $4`,
        [caller.tenantId, s.kind, s.serial.year, s.serial.no],
      );
      // A serial belongs to one student (the DB index has no subject column), so refuse anything else.
      if (
        rows.length === 0 ||
        rows.some(
          (r) =>
            r.subject_type !== s.subjectType ||
            r.subject_id !== s.subjectId ||
            r.context_type !== ctxType ||
            r.context_id !== ctxId,
        )
      ) {
        throw new ConflictException('This serial belongs to a different student');
      }
      copyNumber = Math.max(...rows.map((r) => Number(r.copy_number))) + 1;
    } else if (!s.serial) {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `${caller.tenantId}:${s.subjectType}:${s.subjectId}:${s.kind}:${ctxType ?? ''}:${ctxId ?? ''}`,
      ]);
      const [{ n }] = await manager.query(
        `SELECT coalesce(max(copy_number), 0) + 1 AS n FROM print_job_items
          WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3 AND document_kind = $4
            AND context_type IS NOT DISTINCT FROM $5::varchar
            AND context_id IS NOT DISTINCT FROM $6::uuid`,
        [caller.tenantId, s.subjectType, s.subjectId, s.kind, ctxType, ctxId],
      );
      copyNumber = Number(n);
    }
    const token = generateSecret();
    // Confidential kinds (ACR) have no verify QR: no URL is handed out, so the stored hash
    // belongs to a token nobody holds.
    const verifiable = FIELD_CATALOG[s.kind].some((f) => f.key === 'print.verify_qr');
    const verifyUrl = verifiable ? `/v/${token}` : undefined;
    // D44: copy 1 prints no label; later copies use the template's text, else a kind default.
    // D8: a serial kind always gets a label — a blank template text cannot hide the DUPLICATE.
    const serialKind = isSerialKind(s.kind);
    const copyLabel =
      copyNumber === 1
        ? ''
        : (serialKind
            ? s.copyLabelText?.trim() || DEFAULT_SERIAL_COPY_LABEL
            : (s.copyLabelText ?? 'Copy {n}')
          ).replaceAll('{n}', String(copyNumber));
    const values: Record<string, unknown> = {
      ...s.baseValues,
      'print.copyLabel': copyLabel,
      'print.issue_date': s.issueDate,
      ...(verifyUrl ? { 'print.verify_qr': verifyUrl } : {}),
    };
    const serialText = (s.baseValues['print.serial_no'] as string | undefined) ?? null;
    let item: PrintJobItem;
    try {
      item = await manager.save(
        manager.create(PrintJobItem, {
          tenant_id: caller.tenantId,
          job_id: jobId,
          document_kind: s.kind,
          subject_type: s.subjectType,
          subject_id: s.subjectId,
          subject_label: s.label.slice(0, 200),
          copy_number: copyNumber,
          serial_no: s.serial?.no ?? null,
          serial_year: s.serial?.year ?? null,
          context_type: ctxType,
          context_id: ctxId,
          ...(s.outcome ? { outcome: s.outcome } : {}),
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
    } catch (e) {
      // The unique indexes are the backstop (D41): a clash is a 409, never a duplicate.
      const code = (e as { driverError?: { code?: string } }).driverError?.code;
      if (code === '23505') {
        throw new ConflictException('This copy number or serial was just taken. Try again.');
      }
      throw e;
    }
    await this.audit.record(
      {
        action: AuditAction.CREATE,
        entity_type: 'PrintJobItem',
        entity_id: item.id,
        tenant_id: caller.tenantId,
        performed_by_user_id: caller.userId,
        new_values: {
          job_id: jobId,
          subject_id: s.subjectId,
          copy_number: copyNumber,
          serial_no: serialText,
          // Keys only: the typed text is in the snapshot.
          ...(s.issueKeys?.length ? { issue_keys: s.issueKeys } : {}),
        },
      },
      manager,
    );
    return {
      item_id: item.id,
      subject_id: s.subjectId,
      label: s.label,
      values,
      copy_number: copyNumber,
      serial_no: serialText,
      verify_url: verifyUrl,
      photo_url: photoUrl(s.subjectType, s.subjectId, s.photoKey, caller.channel),
    };
  }

  /** Stream a subject photo. Old keys stay valid (snapshots reference them, D48). */
  async photo(caller: PrintCaller, type: 'STUDENT' | 'STAFF', subjectId: string, key: string) {
    const kind = type === 'STAFF' ? DocumentKind.STAFF_ID_CARD : DocumentKind.STUDENT_ID_CARD;
    if (caller.channel === 'CERTIFICATE') {
      // Certificates are student documents; the ID-card kind check does not apply.
      if (type !== 'STUDENT') throw new BadRequestException('Not a certificate');
    } else {
      this.assertCanPrint(kind, caller);
    }
    if (!key.startsWith(`tenants/${caller.tenantId}/`) || key.includes('..')) {
      throw new ForbiddenException('Invalid photo key');
    }
    const found = await resolverFor(kind).resolve(caller.tenantId, [subjectId], this.ds.manager);
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
