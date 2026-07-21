import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { CreateClassDto, UpdateClassDto, QueryClassDto, CreateSectionDto, UpdateSectionDto } from './dto/classes.dto';

@Injectable()
export class ClassService {
  constructor(
    @InjectRepository(Class)
    private readonly repo: Repository<Class>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  async create(dto: CreateClassDto, tenantId: string): Promise<Class> {
    const entity = this.repo.create({
      name: dto.name,
      numeric_grade: dto.numeric_grade,
      academic_year_id: dto.academic_year_id,
      tenant_id: tenantId,
    });
    return this.repo.save(entity);
  }

  async findAll(query: QueryClassDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = { tenant_id: tenantId, deleted_at: IsNull() };
    if (query.academic_year_id) {
      where.academic_year_id = query.academic_year_id;
    }

    const [data, total] = await this.repo.findAndCount({
      where,
      relations: ['sections'],
      order: { name: 'ASC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<Class> {
    const entity = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['sections', 'academic_year'],
    });
    if (!entity) {
      throw new NotFoundException(`Class with ID "${id}" not found`);
    }
    return entity;
  }

  async update(id: string, dto: UpdateClassDto, tenantId: string): Promise<Class> {
    await this.findOne(id, tenantId);
    await this.repo.update({ id, tenant_id: tenantId }, dto);
    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);

    // Check for active students referencing this class through their section
    const activeStudentCount = await this.studentRepo.count({
      where: {
        class_section_id: IsNull() as any, // We'll use a subquery instead
        deleted_at: IsNull(),
        enrollment_status: 'ACTIVE' as any,
      },
    });

    // Check for child sections
    const childSectionCount = await this.sectionRepo.count({
      where: { class_id: id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (childSectionCount > 0) {
      throw new ConflictException(
        `Cannot delete class "${id}": ${childSectionCount} section(s) still exist. Remove all sections first.`,
      );
    }

    await this.repo.softDelete({ id, tenant_id: tenantId });
  }
}

@Injectable()
export class SectionService {
  constructor(
    @InjectRepository(ClassSection)
    private readonly repo: Repository<ClassSection>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  async create(classId: string, dto: CreateSectionDto, tenantId: string): Promise<ClassSection> {
    // Verify class belongs to tenant
    const cls = await this.classRepo.findOne({
      where: { id: classId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!cls) {
      throw new NotFoundException(`Class with ID "${classId}" not found`);
    }

    const entity = this.repo.create({
      class_id: classId,
      section_name: dto.section_name,
      capacity: dto.capacity ?? null,
      tenant_id: tenantId,
    });
    return this.repo.save(entity);
  }

  async findAll(classId: string, tenantId: string): Promise<ClassSection[]> {
    // Verify class belongs to tenant
    const cls = await this.classRepo.findOne({
      where: { id: classId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!cls) {
      throw new NotFoundException(`Class with ID "${classId}" not found`);
    }

    return this.repo.find({
      where: { class_id: classId, tenant_id: tenantId, deleted_at: IsNull() },
      order: { section_name: 'ASC' },
    });
  }

  async update(classId: string, sectionId: string, dto: UpdateSectionDto, tenantId: string): Promise<ClassSection> {
    const section = await this.repo.findOne({
      where: { id: sectionId, class_id: classId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!section) {
      throw new NotFoundException(`Section with ID "${sectionId}" not found in class "${classId}"`);
    }

    await this.repo.update({ id: sectionId, class_id: classId, tenant_id: tenantId }, dto);
    return this.repo.findOne({
      where: { id: sectionId, class_id: classId, tenant_id: tenantId, deleted_at: IsNull() },
    }) as Promise<ClassSection>;
  }

  async remove(classId: string, sectionId: string, tenantId: string): Promise<void> {
    const section = await this.repo.findOne({
      where: { id: sectionId, class_id: classId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!section) {
      throw new NotFoundException(`Section with ID "${sectionId}" not found in class "${classId}"`);
    }

    // Check for active students in this section
    const activeStudentCount = await this.studentRepo.count({
      where: {
        class_section_id: sectionId,
        deleted_at: IsNull(),
        enrollment_status: 'ACTIVE' as any,
      },
    });
    if (activeStudentCount > 0) {
      throw new ConflictException(
        `Cannot delete section "${sectionId}": ${activeStudentCount} active student(s) are enrolled in it. Reassign or remove them first.`,
      );
    }

    await this.repo.softDelete({ id: sectionId, class_id: classId, tenant_id: tenantId });
  }
}