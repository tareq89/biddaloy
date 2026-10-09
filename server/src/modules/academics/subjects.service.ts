import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, QueryFailedError } from 'typeorm';
import { StudentSubjectChoice } from '../students/entities/student-subject-choice.entity';
import { Subject } from './entities/subject.entity';
import { ClassSubject } from './entities/class-subject.entity';
import { Class } from './entities/class.entity';
import { AcademicYear } from './entities/academic-year.entity';
import {
  CreateSubjectDto,
  UpdateSubjectDto,
  QuerySubjectDto,
  AttachClassSubjectDto,
  UpdateClassSubjectDto,
} from './dto/subjects.dto';
import { SchoolSettingsReader } from '../schools/settings/school-settings-reader.service';
import { assertInVocabulary } from '../schools/settings/organisation-vocabulary.util';

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
    private readonly settingsReader: SchoolSettingsReader,
  ) {}

  /** [35.1.2] '' -> null; non-null must be in `organisation.groups`; a row
   * is group-specific OR optional, never both. */
  private async resolveGroupName(
    groupName: string | null | undefined,
    isOptional: boolean,
    tenantId: string,
  ): Promise<string | null> {
    const group = groupName === '' || groupName === undefined ? null : groupName;
    if (group === null) return null;
    if (isOptional) {
      throw new BadRequestException('A subject is either group-specific or optional, not both');
    }
    const organisation = await this.settingsReader.organisationVocabulary(tenantId);
    assertInVocabulary(group, organisation.groups, 'group');
    return group;
  }

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
      const offerings = await manager.find(ClassSubject, {
        where: { subject_id: id, tenant_id: tenantId },
        select: { id: true },
      });
      if (offerings.length > 0) {
        await manager.delete(StudentSubjectChoice, {
          class_subject_id: In(offerings.map((o) => o.id)),
          tenant_id: tenantId,
        });
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

    const isOptional = dto.is_optional ?? false;
    const groupName = await this.resolveGroupName(dto.group_name, isOptional, tenantId);
    const choiceGroup = this.resolveChoiceGroup(dto.choice_group, isOptional, groupName);

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
        is_optional: isOptional,
        group_name: groupName,
        choice_group: choiceGroup,
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

  /** [35.1.2] Edit is_optional / group_name on an existing offering. */
  async updateClassSubject(
    classId: string,
    subjectId: string,
    dto: UpdateClassSubjectDto,
    tenantId: string,
  ): Promise<ClassSubject> {
    // Read, validate and write under one row lock: two concurrent PATCHes on
    // the same offering would otherwise each validate against stale
    // is_optional/group_name and the later save would clobber the other.
    const rowId = await this.repo.manager.transaction(async (manager) => {
      const row = await manager
        .createQueryBuilder(ClassSubject, 'cs')
        .setLock('pessimistic_write')
        .where(
          `cs.class_id = :classId AND cs.subject_id = :subjectId
           AND cs.academic_year_id = :yearId AND cs.tenant_id = :tenantId
           AND cs.deleted_at IS NULL`,
          { classId, subjectId, yearId: dto.academic_year_id, tenantId },
        )
        .getOne();
      if (!row) {
        throw new NotFoundException(
          `Subject "${subjectId}" is not offered by class "${classId}" in that academic year`,
        );
      }
      const isOptional = dto.is_optional ?? row.is_optional;
      const groupName =
        dto.group_name !== undefined
          ? await this.resolveGroupName(dto.group_name, isOptional, tenantId)
          : row.group_name;
      // group_name untouched but optional flipped on a grouped row.
      if (isOptional && groupName !== null) {
        throw new BadRequestException('A subject is either group-specific or optional, not both');
      }
      const choiceGroup = this.resolveChoiceGroup(
        dto.choice_group !== undefined ? dto.choice_group : row.choice_group,
        isOptional,
        groupName,
      );
      row.is_optional = isOptional;
      row.group_name = groupName;
      row.choice_group = choiceGroup;
      try {
        await manager.save(ClassSubject, row);
      } catch (err) {
        // The picks table's trigger/unique index guard these (23505/23514). Throwing
        // here rolls the whole transaction back, so nothing is half-applied.
        const code = err instanceof QueryFailedError ? (err as any).code : null;
        if (code === '23505') {
          throw new ConflictException(
            'Some students already picked two subjects that would now share this choice group',
          );
        }
        if (code === '23514') {
          throw new ConflictException(
            'A fourth-subject pick exists for this offering; clear it first',
          );
        }
        throw err;
      }
      return row.id;
    });
    return (await this.classSubjectRepo.findOne({
      where: { id: rowId },
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
    // Stale picks would block re-picking after re-attach (23505).
    await this.classSubjectRepo.manager.transaction(async (manager) => {
      await manager.delete(StudentSubjectChoice, {
        class_subject_id: classSubject.id,
        tenant_id: tenantId,
      });
      await manager.softDelete(ClassSubject, { id: classSubject.id });
    });
  }

  /** [35.1.8] ''/undefined/null -> null; a group can't be optional or group-specific. */
  private resolveChoiceGroup(
    value: string | null | undefined,
    isOptional: boolean,
    groupName: string | null,
  ): string | null {
    const group = value?.trim() || null;
    if (group !== null && (isOptional || groupName !== null)) {
      throw new BadRequestException(
        'A subject in a choice group cannot also be optional or group-specific',
      );
    }
    return group;
  }
}
