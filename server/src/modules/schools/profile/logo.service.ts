import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import sharp from 'sharp';
import type { Readable } from 'stream';
import { AuditAction } from '@biddaloy/shared';
import { School } from '../entities/school.entity';
import { StorageService } from '../../storage/storage.service';
import { tenantObjectKey } from '../../storage/storage-key';
import { AuditService } from '../../audit/audit.service';
import { RequestContext } from '../../../common/request-context.util';
import { buildLogoUrl, logoKeyForVersion } from './logo-key';

const ALLOWED_FORMATS = new Set(['png', 'jpeg', 'webp']);
const MAX_SOURCE_DIMENSION = 2048;
const TARGET_DIMENSION = 512;

/**
 * [15.5.3] Logo upload/removal. Bytes are validated and re-encoded with
 * `sharp` before ever touching storage — the browser-reported MIME type on
 * the upload is never trusted, only what `sharp` itself detects.
 *
 * Replacing or removing a logo only changes `School.logo_key`; the previous
 * object stays in storage. Every invoice/payment issued while it was
 * current carries its key in `issuer_snapshot.logo_key` ([15.5.5]) and
 * prints it via `GET /schools/:id/logo?v=<uuid>` / `readLogoDataUrl`, so
 * deleting it would silently strip the logo off already-issued documents.
 * Logos are small (<=512x512 PNG) and replaced rarely, so the retained
 * objects cost far less than a retention scheme keyed off document refs.
 */
@Injectable()
export class SchoolLogoService {
  constructor(
    @InjectRepository(School)
    private readonly repo: Repository<School>,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
  ) {}

  async upload(
    schoolId: string,
    fileBuffer: Buffer,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<{ logo_url: string }> {
    let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
    try {
      metadata = await sharp(fileBuffer).metadata();
    } catch {
      throw new BadRequestException('File is not a readable image');
    }

    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
      throw new BadRequestException('Image must be PNG, JPEG or WebP');
    }
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > MAX_SOURCE_DIMENSION ||
      metadata.height > MAX_SOURCE_DIMENSION
    ) {
      throw new BadRequestException(`Image dimensions must not exceed ${MAX_SOURCE_DIMENSION}px`);
    }

    const reencoded = await sharp(fileBuffer)
      .resize({ width: TARGET_DIMENSION, height: TARGET_DIMENSION, fit: 'inside' })
      .png()
      .toBuffer();

    const newKey = tenantObjectKey(schoolId, 'logo', 'png');
    await this.storage.put(newKey, reencoded, 'image/png');

    await this.repo.manager.transaction(async (manager) => {
      const schoolRepo = manager.getRepository(School);
      const school = await schoolRepo
        .createQueryBuilder('school')
        .where('school.id = :id', { id: schoolId })
        .setLock('pessimistic_write')
        .getOne();
      if (!school) {
        throw new NotFoundException(`School with ID "${schoolId}" not found`);
      }

      const previousKey = school.logo_key;
      school.logo_key = newKey;
      await schoolRepo.save(school);

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'School',
          entity_id: schoolId,
          tenant_id: schoolId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { logo_key: previousKey },
          new_values: { logo_key: newKey },
        },
        manager,
      );
    });

    return { logo_url: buildLogoUrl(schoolId, newKey) as string };
  }

  /** [15.5.4] Streams logo bytes for `schoolId`. With `version` (the
   * `v=<uuid>` from a `logo_url` or a document's `issuer_snapshot.logo_key`)
   * it's that exact object — so a receipt keeps showing the logo it was
   * issued with after a replace or remove. Without it, the school's current
   * logo. `NotFoundException` when there's nothing to serve. Never returns
   * the storage key — the caller only ever sees a stream + content type. */
  async serve(
    schoolId: string,
    version?: string,
  ): Promise<{ stream: Readable; contentType: string }> {
    let key: string | null;
    if (version !== undefined) {
      key = logoKeyForVersion(schoolId, version);
      if (!key) {
        throw new NotFoundException(`School "${schoolId}" has no logo version "${version}"`);
      }
    } else {
      const school = await this.repo.findOne({ where: { id: schoolId } });
      key = school?.logo_key ?? null;
      if (!key) {
        throw new NotFoundException(`School "${schoolId}" has no logo`);
      }
    }

    let object: Awaited<ReturnType<StorageService['get']>>;
    try {
      object = await this.storage.get(key);
    } catch (error: unknown) {
      if (isMissingObjectError(error)) {
        throw new NotFoundException(`School "${schoolId}" has no logo version "${version}"`);
      }
      throw error;
    }
    return { stream: object.body, contentType: object.contentType ?? 'image/png' };
  }

  async remove(
    schoolId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      const schoolRepo = manager.getRepository(School);
      const school = await schoolRepo
        .createQueryBuilder('school')
        .where('school.id = :id', { id: schoolId })
        .setLock('pessimistic_write')
        .getOne();
      if (!school) {
        throw new NotFoundException(`School with ID "${schoolId}" not found`);
      }

      const previousKey = school.logo_key;
      school.logo_key = null;
      await schoolRepo.save(school);

      if (previousKey) {
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'School',
            entity_id: schoolId,
            tenant_id: schoolId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: { logo_key: previousKey },
            new_values: { logo_key: null },
          },
          manager,
        );
      }
    });
  }
}

/** The AWS SDK's "no such object" shapes — `NoSuchKey` from GetObject,
 * `NotFound` from HeadObject, or a bare 404 from an S3-compatible store. */
export function isMissingObjectError(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const statusCode = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || statusCode === 404;
}
