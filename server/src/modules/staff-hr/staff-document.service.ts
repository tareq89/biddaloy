import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction, StaffDocumentType } from '@biddaloy/shared';
import { StaffDocument } from './entities/staff-document.entity';
import { StorageService, StoredObject } from '../storage/storage.service';
import { tenantObjectKey } from '../storage/storage-key';
import { AuditService } from '../audit/audit.service';

interface CallerContext {
  userId: string;
  tenantId: string;
}

const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const STAFF_DOCUMENT_MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * [23.6] Upload/replace/download of staff HR documents (NID, birth
 * certificate, photo, other). `upload()` is a straight clone of
 * `HomeworkSubmissionService.upload()` (server/src/modules/homework/
 * homework-submission.service.ts:130-220): validate → `storage.put` the new
 * object → save the row → best-effort `storage.delete` of the object it
 * replaced. That last step is the orphan-cleanup fix homework's history
 * required — skipping it silently leaves the old S3 object unreferenced
 * forever.
 */
@Injectable()
export class StaffDocumentService {
  constructor(
    @InjectRepository(StaffDocument)
    private readonly repo: Repository<StaffDocument>,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private validateFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    if (file.size > STAFF_DOCUMENT_MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File must be at most ${STAFF_DOCUMENT_MAX_FILE_SIZE / (1024 * 1024)}MB`,
      );
    }
    if (!ALLOWED_MIME_TO_EXT[file.mimetype]) {
      throw new BadRequestException('File must be PDF, JPG, PNG or WebP');
    }
    if (file.originalname.length > 255) {
      throw new BadRequestException('Filename must be at most 255 characters');
    }
  }

  /**
   * Upload (or replace) one document of a given type for a staff member.
   * Only one row per (tenant, staff_user, document_type) is kept — a
   * re-upload replaces the row in place and orphan-deletes the old object,
   * mirroring homework submissions' resubmission behavior.
   */
  async upload(
    staffUserId: string,
    documentType: StaffDocumentType,
    file: Express.Multer.File,
    ctx: CallerContext,
  ): Promise<StaffDocument> {
    this.validateFile(file);

    const ext = ALLOWED_MIME_TO_EXT[file.mimetype];
    const key = tenantObjectKey(ctx.tenantId, 'staff-documents', ext);
    await this.storage.put(key, file.buffer, file.mimetype);

    // ponytail: read-then-save has a race window under concurrent uploads
    // for the same (tenant, staff_user, document_type) — the DB's UNIQUE
    // index (UQ_staff_documents_tenant_staff_type) stops it from ever
    // creating two rows, so the failure mode is a 500 on the loser's insert
    // (same ceiling homework-submission.service.ts accepts for its own
    // read-then-create race), not silent duplication.
    let doc = await this.repo.findOne({
      where: { tenant_id: ctx.tenantId, staff_user_id: staffUserId, document_type: documentType },
    });
    const previousKey = doc?.storage_key ?? null;
    const isReplace = !!doc;

    if (!doc) {
      doc = this.repo.create({
        tenant_id: ctx.tenantId,
        staff_user_id: staffUserId,
        document_type: documentType,
      });
    }
    doc.storage_key = key;
    doc.original_filename = file.originalname;
    doc.content_type = file.mimetype;
    doc.uploaded_by_user_id = ctx.userId;

    let saved: StaffDocument;
    try {
      saved = await this.repo.save(doc);
    } catch (err) {
      // The save failed — the object just uploaded is now orphaned too.
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }

    // Best-effort: a delete failure here must never mask a successful save.
    if (previousKey) {
      await this.storage.delete(previousKey).catch(() => undefined);
    }

    await this.audit.record({
      action: isReplace ? AuditAction.UPDATE : AuditAction.CREATE,
      entity_type: 'StaffDocument',
      entity_id: saved.id,
      tenant_id: ctx.tenantId,
      performed_by_user_id: ctx.userId,
      new_values: { staff_user_id: staffUserId, document_type: documentType },
    });

    return saved;
  }

  async findAllForStaff(staffUserId: string, tenantId: string): Promise<StaffDocument[]> {
    return this.repo.find({ where: { tenant_id: tenantId, staff_user_id: staffUserId } });
  }

  /**
   * Tenant-scoped download. The lookup filters on `tenant_id` in the same
   * query as `id` — a staff member from tenant A can never fetch tenant B's
   * document by guessing its id, because the row simply won't be found (a
   * 404, not a 403 — matching `WorkbookController.download`'s pattern of
   * not distinguishing "not yours" from "doesn't exist").
   */
  async download(
    id: string,
    tenantId: string,
  ): Promise<{ doc: StaffDocument; object: StoredObject }> {
    const doc = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    const object = await this.storage.get(doc.storage_key);
    return { doc, object };
  }
}
