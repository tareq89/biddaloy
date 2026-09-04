import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Subject } from './entities/subject.entity';
import { ClassSubject } from './entities/class-subject.entity';
import { Class } from './entities/class.entity';
import { AcademicYear } from './entities/academic-year.entity';
import {
  CreateSubjectDto,
  UpdateSubjectDto,
  QuerySubjectDto,
  AttachClassSubjectDto,
} from './dto/subjects.dto';

export interface PaginatedSubjects {
  data: Subject[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class SubjectService {
  constructor(
    @InjectRepository(Subject)
    private readonly repo: Repository<Subject>,
    @InjectRepository(ClassSubject)
    private readonly classSubjectRepo: Repository<ClassSubject>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
  ) {}

  async create(dto: CreateSubjectDto, tenantId: string): Promise<Subject> {
    const existing = await this.repo.findOne({
      where: { tenant_id: tenantId, code: dto.code, deleted_at: IsNull() },
    });
    if (existing) {
      throw new ConflictException(`Subject with code "${dto.code}" already exists`);
    }

    const entity = this.repo.create({
      name_en: dto.name_en,
      name_bn: dto.name_bn ?? null,
      code: dto.code,
      is_active: dto.is_active ?? true,
      tenant_id: tenantId,
    });
    return this.repo.save(entity);
  }

  async findAll(query: QuerySubjectDto, tenantId: string): Promise<PaginatedSubjects> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenant_id: tenantId, deleted_at: IsNull() };
    if (query.is_active !== undefined) {
      where.is_active = query.is_active;
    }

    const [data, total] = await this.repo.findAndCount({
      where,
      order: { name_en: 'ASC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<Subject> {
    const entity = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException(`Subject with ID "${id}" not found`);
    }
    return entity;
  }

  async update(id: string, dto: UpdateSubjectDto, tenantId: string): Promise<Subject> {
    await this.findOne(id, tenantId);

    if (dto.code) {
      const existing = await this.repo.findOne({
        where: { tenant_id: tenantId, code: dto.code, deleted_at: IsNull() },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(`Subject with code "${dto.code}" already exists`);
      }
    }

    await this.repo.update({ id, tenant_id: tenantId }, dto);
    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);
    await this.repo.manager.transaction(async (manager) => {
      // Lock the subject row first — without this, a concurrent
      // attachToClass() could read the subject as active between this
      // transaction's two soft deletes and insert a ClassSubject pointing
      // at a subject we're in the middle of removing. Locking here
      // serializes with attachToClass()'s own lock on the same row.
      const locked = await manager
        .createQueryBuilder(Subject, 'subject')
        .setLock('pessimistic_write')
        .where('subject.id = :id AND subject.tenant_id = :tenantId', { id, tenantId })
        .getOne();
      if (!locked) {
        throw new NotFoundException(`Subject with ID "${id}" not found`);
      }
      await manager.softDelete(ClassSubject, { subject_id: id, tenant_id: tenantId });
      await manager.softDelete(Subject, { id, tenant_id: tenantId });
    });
  }

  /** Class detail page's Subjects tab — every subject offered by a class
   * in a given academic year. */
  async findByClass(
    classId: string,
    academicYearId: string,
    tenantId: string,
  ): Promise<ClassSubject[]> {
    const cls = await this.classRepo.findOne({
      where: { id: classId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!cls) {
      throw new NotFoundException(`Class with ID "${classId}" not found`);
    }

    return this.classSubjectRepo.find({
      where: {
        class_id: classId,
        academic_year_id: academicYearId,
        tenant_id: tenantId,
        deleted_at: IsNull(),
      },
      relations: ['subject'],
      order: { created_at: 'ASC' },
    });
  }

  async attachToClass(
    classId: string,
    dto: AttachClassSubjectDto,
    tenantId: string,
  ): Promise<ClassSubject> {
    // Verify class belongs to tenant — never trust an id from the body.
    const cls = await this.classRepo.findOne({
      where: { id: classId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!cls) {
      throw new NotFoundException(`Class with ID "${classId}" not found`);
    }

    // Verify academic year belongs to tenant.
    const academicYear = await this.academicYearRepo.findOne({
      where: { id: dto.academic_year_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!academicYear) {
      throw new NotFoundException(`Academic year with ID "${dto.academic_year_id}" not found`);
    }

    // The academic year must match the class's own — a class can't offer a
    // subject under a different year than the one it belongs to.
    if (cls.academic_year_id !== dto.academic_year_id) {
      throw new ConflictException(
        `Class "${classId}" belongs to a different academic year than "${dto.academic_year_id}"`,
      );
    }

    const savedId = await this.repo.manager.transaction(async (manager) => {
      // Lock the subject row before trusting it as active — serializes
      // with SubjectService.remove()'s own lock on the same row, so a
      // concurrent removal can't finish between this check and the insert
      // below and leave an active ClassSubject pointing at a deleted
      // subject.
      const subject = await manager
        .createQueryBuilder(Subject, 'subject')
        .setLock('pessimistic_write')
        .where(
          'subject.id = :id AND subject.tenant_id = :tenantId AND subject.deleted_at IS NULL',
          {
            id: dto.subject_id,
            tenantId,
          },
        )
        .getOne();
      if (!subject) {
        throw new NotFoundException(`Subject with ID "${dto.subject_id}" not found`);
      }

      const existing = await manager.findOne(ClassSubject, {
        where: {
          class_id: classId,
          subject_id: dto.subject_id,
          academic_year_id: dto.academic_year_id,
          deleted_at: IsNull(),
        },
      });
      if (existing) {
        throw new ConflictException(
          `Subject "${dto.subject_id}" is already offered by class "${classId}" in that academic year`,
        );
      }

      const entity = manager.create(ClassSubject, {
        class_id: classId,
        subject_id: dto.subject_id,
        academic_year_id: dto.academic_year_id,
        is_optional: dto.is_optional ?? false,
        tenant_id: tenantId,
      });
      const saved = await manager.save(ClassSubject, entity);
      return saved.id;
    });

    return (await this.classSubjectRepo.findOne({
      where: { id: savedId },
      relations: ['subject'],
    })) as ClassSubject;
  }

  async detachFromClass(
    classId: string,
    subjectId: string,
    academicYearId: string,
    tenantId: string,
  ): Promise<void> {
    const classSubject = await this.classSubjectRepo.findOne({
      where: {
        class_id: classId,
        subject_id: subjectId,
        academic_year_id: academicYearId,
        tenant_id: tenantId,
        deleted_at: IsNull(),
      },
    });
    if (!classSubject) {
      throw new NotFoundException(
        `Subject "${subjectId}" is not offered by class "${classId}" in that academic year`,
      );
    }
    await this.classSubjectRepo.softDelete({ id: classSubject.id });
  }
}
