import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import sharp from 'sharp';
import type { Readable } from 'stream';
import { AuditAction } from '@biddaloy/shared';
import { Student } from './entities/student.entity';
import { StorageService } from '../storage/storage.service';
import { tenantObjectKey } from '../storage/storage-key';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { isMissingObjectError } from '../schools/profile/logo.service';

const ALLOWED_FORMATS = new Set(['png', 'jpeg', 'webp']);
export const STUDENT_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_DIMENSION = 6000;
const TARGET_DIMENSION = 800;
const JPEG_QUALITY = 85;

export interface BulkPhotoFile {
  originalname: string;
  buffer: Buffer;
}

export interface BulkPhotoResult {
  matched: { file: string; student_id: string; full_name: string }[];
  unmatched: string[];
  invalid: { file: string; reason: string }[];
}

/**
 * [32.2.5] Student photos. Same trust model as the school logo upload: the
 * browser MIME type is ignored, `sharp` decides the format, and the bytes are
 * re-encoded to a bounded JPEG (EXIF orientation applied) before storage.
 *
 * D48: replacing a photo only repoints `students.photo_key`. The old object is
 * never deleted — printed-document snapshots may still reference its key.
 */
@Injectable()
export class StudentPhotoService {
  constructor(
    @InjectRepository(Student)
    private readonly repo: Repository<Student>,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
  ) {}

  /** Throws BadRequestException for anything that isn't a sane png/jpeg/webp. */
  private async reencode(fileBuffer: Buffer): Promise<Buffer> {
    if (fileBuffer.length > STUDENT_PHOTO_MAX_BYTES) {
      throw new BadRequestException('Image must not exceed 8 MB');
    }
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
    try {
      return await sharp(fileBuffer)
        .rotate()
        .resize({
          width: TARGET_DIMENSION,
          height: TARGET_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
    } catch {
      // Header parsed but pixel data is corrupt.
      throw new BadRequestException('File is not a readable image');
    }
  }

  private async findStudent(id: string, tenantId: string): Promise<Student> {
    const student = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!student) throw new NotFoundException(`Student with ID "${id}" not found`);
    return student;
  }

  async upload(
    studentId: string,
    fileBuffer: Buffer,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<{ photo: true }> {
    await this.findStudent(studentId, tenantId);
    await this.store(studentId, await this.reencode(fileBuffer), tenantId, userId, context);
    return { photo: true };
  }

  private async store(
    studentId: string,
    jpeg: Buffer,
    tenantId: string,
    userId: string,
    context: RequestContext,
  ): Promise<void> {
    const newKey = tenantObjectKey(tenantId, 'student-photo', 'jpg');
    await this.storage.put(newKey, jpeg, 'image/jpeg');

    // Its own transaction per student: in bulk mode one failure must not roll
    // back the photos already saved.
    await this.repo.manager.transaction(async (manager) => {
      const studentRepo = manager.getRepository(Student);
      const student = await studentRepo
        .createQueryBuilder('student')
        .where('student.id = :id AND student.tenant_id = :tenantId', { id: studentId, tenantId })
        .setLock('pessimistic_write')
        .getOne();
      if (!student) throw new NotFoundException(`Student with ID "${studentId}" not found`);

      // D48: previous object is intentionally left in storage.
      student.photo_key = newKey;
      await studentRepo.save(student);

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Student',
          entity_id: studentId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          new_values: { photo: true },
        },
        manager,
      );
    });
  }

  /** File name (minus extension, trimmed) == registration number. */
  async bulkUpload(
    files: BulkPhotoFile[],
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<BulkPhotoResult> {
    const result: BulkPhotoResult = { matched: [], unmatched: [], invalid: [] };
    for (const file of files) {
      const name = file.originalname;
      const stem = name
        .replace(/^.*[\\/]/, '')
        .replace(/\.[^.]*$/, '')
        .trim();
      const student = stem
        ? await this.repo.findOne({
            where: { registration_number: stem, tenant_id: tenantId, deleted_at: IsNull() },
          })
        : null;
      if (!student) {
        result.unmatched.push(name);
        continue;
      }
      try {
        await this.store(student.id, await this.reencode(file.buffer), tenantId, userId, context);
        result.matched.push({ file: name, student_id: student.id, full_name: student.full_name });
      } catch (error: unknown) {
        if (error instanceof BadRequestException || error instanceof NotFoundException) {
          result.invalid.push({ file: name, reason: error.message });
        } else {
          throw error;
        }
      }
    }
    return result;
  }

  /** Caller must already have done the read-access check for `studentId`. */
  async serve(
    studentId: string,
    tenantId: string,
  ): Promise<{ stream: Readable; contentType: string }> {
    const student = await this.findStudent(studentId, tenantId);
    if (!student.photo_key) throw new NotFoundException('Student has no photo');
    try {
      const object = await this.storage.get(student.photo_key);
      return { stream: object.body, contentType: object.contentType ?? 'image/jpeg' };
    } catch (error: unknown) {
      if (isMissingObjectError(error)) throw new NotFoundException('Student has no photo');
      throw error;
    }
  }
}
