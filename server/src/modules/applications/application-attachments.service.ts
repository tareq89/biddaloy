import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { ATTACHMENT_LIMITS, ApplicationStatus, AuditAction } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { StorageService, type StoredObject } from '../storage/storage.service';
import { tenantObjectKey } from '../storage/storage-key';
import { matchesDeclaredType } from '../storage/file-signature';
import { ApplicationsService } from './applications.service';
import { Application } from './entities/application.entity';
import { ApplicationAttachment } from './entities/application-attachment.entity';
import type { ApplicationCaller } from './reviewer-scope';
import type { ApplicationAttachmentDto } from './dto/application.dto';

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const err = (message: string, details: Record<string, unknown>) => ({ message, details });

const toDto = (a: ApplicationAttachment): ApplicationAttachmentDto => ({
  id: a.id,
  file_name: a.file_name,
  mime_type: a.mime_type,
  size_bytes: a.size_bytes,
  uploaded_by_user_id: a.uploaded_by_user_id,
  created_at: a.created_at.toISOString(),
});

/** [52.2.3] Upload, download and delete of application attachments (D10, D42). */
@Injectable()
export class ApplicationAttachmentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly applications: ApplicationsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Applicant or enterer only (403), and only while PENDING (422). Optionally row-locks. */
  private async writable(
    manager: EntityManager,
    tenantId: string,
    user: ApplicationCaller,
    id: string,
    lock = false,
  ): Promise<Application> {
    const app = await manager.findOne(Application, {
      where: { id, tenant_id: tenantId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!app) throw new NotFoundException('Application not found');
    if (app.applicant_user_id !== user.userId && app.entered_by_user_id !== user.userId) {
      throw new ForbiddenException('Only the applicant can change attachments');
    }
    if (app.status !== ApplicationStatus.PENDING) {
      throw new UnprocessableEntityException(
        err('Attachments can only change on a pending application', {
          code: 'APPLICATION_NOT_PENDING',
        }),
      );
    }
    return app;
  }

  private async assertRoom(manager: EntityManager, app: Application, adding: number) {
    const existing = await manager.count(ApplicationAttachment, {
      where: { tenant_id: app.tenant_id, application_id: app.id },
    });
    if (existing + adding > ATTACHMENT_LIMITS.maxFiles) {
      throw new UnprocessableEntityException(
        err(`An application can have at most ${ATTACHMENT_LIMITS.maxFiles} attachments`, {
          code: 'APPLICATION_ATTACHMENT_LIMIT',
          max: ATTACHMENT_LIMITS.maxFiles,
        }),
      );
    }
  }

  async upload(
    tenantId: string,
    user: ApplicationCaller,
    applicationId: string,
    files: Express.Multer.File[],
  ): Promise<ApplicationAttachmentDto[]> {
    await this.applications.get(tenantId, user, applicationId); // 404 if not visible
    // Array check, not just `.length`: a tampered request must not pass a string here (CodeQL).
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    const manager = this.dataSource.manager;
    const current = await this.writable(manager, tenantId, user, applicationId);
    await this.assertRoom(manager, current, files.length);

    for (const file of files) {
      if (!(ATTACHMENT_LIMITS.mime as readonly string[]).includes(file.mimetype)) {
        throw new BadRequestException('File must be PDF, JPG or PNG');
      }
      if (file.size > ATTACHMENT_LIMITS.maxBytes) {
        throw new BadRequestException(
          `File must be at most ${ATTACHMENT_LIMITS.maxBytes / (1024 * 1024)}MB`,
        );
      }
      if (!matchesDeclaredType(file.buffer, file.mimetype)) {
        throw new BadRequestException('File content does not match its declared type');
      }
      if (file.originalname.length > 255) {
        throw new BadRequestException('Filename must be at most 255 characters');
      }
    }

    const keys: string[] = [];
    try {
      for (const file of files) {
        const key = tenantObjectKey(tenantId, 'application-attachments', EXT[file.mimetype]);
        keys.push(key);
        await this.storage.put(key, file.buffer, file.mimetype);
      }
      const saved = await this.dataSource.transaction(async (tx) => {
        // Lock + re-count so two parallel uploads cannot both pass the limit.
        const app = await this.writable(tx, tenantId, user, applicationId, true);
        await this.assertRoom(tx, app, files.length);
        const rows = await tx.save(
          ApplicationAttachment,
          files.map((file, i) =>
            tx.create(ApplicationAttachment, {
              tenant_id: tenantId,
              application_id: app.id,
              storage_key: keys[i],
              file_name: file.originalname,
              mime_type: file.mimetype,
              size_bytes: file.size,
              uploaded_by_user_id: user.userId,
            }),
          ),
        );
        for (const row of rows) {
          await this.audit.record(
            {
              action: AuditAction.CREATE,
              entity_type: 'ApplicationAttachment',
              entity_id: row.id,
              tenant_id: tenantId,
              performed_by_user_id: user.userId,
              new_values: { application_id: app.id, file_name: row.file_name },
            },
            tx,
          );
        }
        return rows;
      });
      return saved.map(toDto);
    } catch (e) {
      await Promise.all(keys.map((k) => this.storage.delete(k).catch(() => undefined)));
      throw e;
    }
  }

  async open(
    tenantId: string,
    user: ApplicationCaller,
    applicationId: string,
    attachmentId: string,
  ): Promise<{ file: ApplicationAttachment; object: StoredObject }> {
    await this.applications.get(tenantId, user, applicationId);
    const file = await this.dataSource.manager.findOne(ApplicationAttachment, {
      where: { id: attachmentId, application_id: applicationId, tenant_id: tenantId },
    });
    if (!file) throw new NotFoundException('Attachment not found');
    return { file, object: await this.storage.get(file.storage_key) };
  }

  async remove(
    tenantId: string,
    user: ApplicationCaller,
    applicationId: string,
    attachmentId: string,
  ): Promise<void> {
    await this.applications.get(tenantId, user, applicationId);
    const key = await this.dataSource.transaction(async (tx) => {
      const app = await this.writable(tx, tenantId, user, applicationId, true);
      const file = await tx.findOne(ApplicationAttachment, {
        where: { id: attachmentId, application_id: app.id, tenant_id: tenantId },
      });
      if (!file) throw new NotFoundException('Attachment not found');
      await tx.delete(ApplicationAttachment, { id: file.id, tenant_id: tenantId });
      await this.audit.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'ApplicationAttachment',
          entity_id: file.id,
          tenant_id: tenantId,
          performed_by_user_id: user.userId,
          old_values: { application_id: app.id, file_name: file.file_name },
        },
        tx,
      );
      return file.storage_key;
    });
    await this.storage.delete(key).catch(() => undefined);
  }
}
