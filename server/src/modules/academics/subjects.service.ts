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
    await this.repo.softDelete({ id, tenant_id: tenantId });
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

    // Verify subject belongs to tenant.
    const subject = await this.repo.findOne({
      where: { id: dto.subject_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!subject) {
      throw new NotFoundException(`Subject with ID "${dto.subject_id}" not found`);
    }

    // Verify academic year belongs to tenant.
    const academicYear = await this.academicYearRepo.findOne({
      where: { id: dto.academic_year_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!academicYear) {
      throw new NotFoundException(`Academic year with ID "${dto.academic_year_id}" not found`);
    }

    const existing = await this.classSubjectRepo.findOne({
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

    const entity = this.classSubjectRepo.create({
      class_id: classId,
      subject_id: dto.subject_id,
      academic_year_id: dto.academic_year_id,
      is_optional: dto.is_optional ?? false,
      tenant_id: tenantId,
    });
    const saved = await this.classSubjectRepo.save(entity);
    return (await this.classSubjectRepo.findOne({
      where: { id: saved.id },
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
