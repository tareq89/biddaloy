import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { buildLogoUrl } from './profile.service';

const ALLOWED_FORMATS = new Set(['png', 'jpeg', 'webp']);
const MAX_SOURCE_DIMENSION = 2048;
const TARGET_DIMENSION = 512;

/**
 * [15.5.3] Logo upload/removal. Bytes are validated and re-encoded with
 * `sharp` before ever touching storage — the browser-reported MIME type on
 * the upload is never trusted, only what `sharp` itself detects.
 */
@Injectable()
export class SchoolLogoService {
  private readonly logger = new Logger(SchoolLogoService.name);

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

    const { oldKey } = await this.repo.manager.transaction(async (manager) => {
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

      return { oldKey: previousKey };
    });

    if (oldKey) {
      // Best-effort cleanup, after commit — a delete failure here must not
      // undo the already-committed logo change.
      try {
        await this.storage.delete(oldKey);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to delete previous logo object "${oldKey}": ${reason}`);
      }
    }

    return { logo_url: buildLogoUrl(schoolId, newKey) as string };
  }

  /** [15.5.4] Streams the logo bytes for `schoolId`, or throws
   * `NotFoundException` if the school has none. Never returns the storage
   * key — the caller only ever sees a stream + content type. */
  async serve(schoolId: string): Promise<{ stream: Readable; contentType: string }> {
    const school = await this.repo.findOne({ where: { id: schoolId } });
    if (!school?.logo_key) {
      throw new NotFoundException(`School "${schoolId}" has no logo`);
    }
    const object = await this.storage.get(school.logo_key);
    return { stream: object.body, contentType: object.contentType ?? 'image/png' };
  }

  async remove(
    schoolId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    const { oldKey } = await this.repo.manager.transaction(async (manager) => {
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

      return { oldKey: previousKey };
    });

    if (oldKey) {
      try {
        await this.storage.delete(oldKey);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to delete removed logo object "${oldKey}": ${reason}`);
      }
    }
  }
}
