import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import {
  CreateStudentDto,
  UpdateStudentDto,
  QueryStudentDto,
  CreateGuardianDto,
  UpdateGuardianDto,
  QueryGuardianDto,
} from './dto/students.dto';

@Injectable()
export class StudentService {
  constructor(
    @InjectRepository(Student)
    private readonly repo: Repository<Student>,
    @InjectRepository(Guardian)
    private readonly guardianRepo: Repository<Guardian>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
  ) {}

  async create(dto: CreateStudentDto, tenantId: string): Promise<Student> {
    // Verify section belongs to tenant
    const section = await this.sectionRepo.findOne({
      where: { id: dto.class_section_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!section) {
      throw new NotFoundException(
        `Class section with ID "${dto.class_section_id}" not found`,
      );
    }

    // Generate registration number: REG-{currentYear}-{sequentialNumber}
    const currentYear = new Date().getFullYear();
    const lastStudent = await this.repo.findOne({
      where: { tenant_id: tenantId },
      order: { registration_number: 'DESC' },
    });

    let nextSeq = 1;
    if (lastStudent?.registration_number) {
      const parts = lastStudent.registration_number.split('-');
      if (parts.length === 3 && parseInt(parts[1]) === currentYear) {
        nextSeq = parseInt(parts[2]) + 1;
      }
    }
    const regNumber = `REG-${currentYear}-${String(nextSeq).padStart(5, '0')}`;

    const student = this.repo.create({
      full_name: dto.full_name,
      registration_number: regNumber,
      roll_number: dto.roll_number ?? nextSeq,
      class_section_id: dto.class_section_id,
      date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : new Date(),
      gender: dto.gender ?? null,
      home_address: dto.home_address ?? null,
      preferred_communication: dto.preferred_communication ?? undefined,
    });

    // Set tenant_id as a raw column (student entity doesn't have tenant_id directly)
    // Students are linked to tenant through class_section -> class -> tenant chain
    const savedStudent = await this.repo.save(student);

    // Link guardians if provided
    if (dto.guardian_ids?.length) {
      const guardians = await this.guardianRepo.findByIds(dto.guardian_ids);
      savedStudent.guardians = guardians;
      await this.repo.save(savedStudent);
    }

    return this.repo.findOne({
      where: { id: savedStudent.id },
      relations: ['guardians', 'user'],
    }) as Promise<Student>;
  }

  async findAll(query: QueryStudentDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    // Build query builder since we need to filter via class_section -> class chain
    const qb = this.repo.createQueryBuilder('s')
      .leftJoinAndSelect('s.class_section', 'cs')
      .leftJoinAndSelect('cs.class', 'c')
      .leftJoinAndSelect('s.guardians', 'g')
      .leftJoinAndSelect('s.user', 'u')
      .where('s.deleted_at IS NULL')
      .andWhere('c.tenant_id = :tenantId', { tenantId });

    if (query.class_id) {
      qb.andWhere('c.id = :classId', { classId: query.class_id });
    }
    if (query.section_id) {
      qb.andWhere('cs.id = :sectionId', { sectionId: query.section_id });
    }
    if (query.enrollment_status) {
      qb.andWhere('s.enrollment_status = :status', { status: query.enrollment_status });
    }

    const total = await qb.getCount();
    qb.skip(skip).take(limit).orderBy('s.created_at', 'DESC');

    const data = await qb.getMany();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<Student> {
    const student = await this.repo.findOne({
      where: { id, deleted_at: IsNull() },
      relations: ['guardians', 'user', 'class_section', 'class_section.class'],
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${id}" not found`);
    }

    // Verify tenant access via class_section chain
    if (student.class_section?.class?.tenant_id !== tenantId) {
      throw new NotFoundException(`Student with ID "${id}" not found`);
    }

    return student;
  }

  async update(id: string, dto: UpdateStudentDto, tenantId: string): Promise<Student> {
    await this.findOne(id, tenantId);

    const updateData: any = { ...dto };

    // Handle guardian updates separately
    let guardianIds: string[] | undefined;
    if (dto.guardian_ids) {
      guardianIds = dto.guardian_ids;
      delete updateData.guardian_ids;
    }

    if (dto.date_of_birth) {
      updateData.date_of_birth = new Date(dto.date_of_birth);
    }

    await this.repo.update({ id }, updateData);

    if (guardianIds !== undefined) {
      const student = await this.repo.findOne({
        where: { id },
        relations: ['guardians'],
      });
      if (student) {
        if (guardianIds.length > 0) {
          const guardians = await this.guardianRepo.findByIds(guardianIds);
          student.guardians = guardians;
        } else {
          student.guardians = [];
        }
        await this.repo.save(student);
      }
    }

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);
    await this.repo.softDelete({ id });
  }
}

@Injectable()
export class GuardianService {
  constructor(
    @InjectRepository(Guardian)
    private readonly repo: Repository<Guardian>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  async create(dto: CreateGuardianDto, tenantId: string): Promise<Guardian> {
    const guardian = this.repo.create({
      full_name: dto.full_name,
      relationship: dto.relationship ?? 'Parent',
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      alternate_phone: dto.alternate_phone ?? null,
      address: dto.address ?? null,
      occupation: dto.occupation ?? null,
      preferred_communication: dto.preferred_communication ?? undefined,
      tenant_id: tenantId,
    });
    const saved = await this.repo.save(guardian);

    // Link students if provided
    if (dto.student_ids?.length) {
      const students = await this.studentRepo.findByIds(dto.student_ids);
      saved.students = students;
      await this.repo.save(saved);
    }

    return this.repo.findOne({
      where: { id: saved.id },
      relations: ['students'],
    }) as Promise<Guardian>;
  }

  async findAll(query: QueryGuardianDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = { tenant_id: tenantId, deleted_at: IsNull() };

    if (query.search) {
      const searchTerm = `%${query.search}%`;
      const [data, total] = await this.repo.findAndCount({
        where: [
          { ...where, full_name:  searchTerm } as any,
          { ...where, phone: searchTerm } as any,
          { ...where, email: searchTerm } as any,
        ],
        relations: ['students'],
        order: { created_at: 'DESC' },
        skip,
        take: limit,
      });

      // Recalculate total from this query path
      const actualTotal = data.length;
      // Since findAndCount with OR doesn't accurately count, use total from data
      return { data, total: actualTotal, page, limit, totalPages: Math.ceil(actualTotal / limit) };
    }

    const [data, total] = await this.repo.findAndCount({
      where: { tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['students'],
      order: { created_at: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<Guardian> {
    const guardian = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['students', 'user'],
    });
    if (!guardian) {
      throw new NotFoundException(`Guardian with ID "${id}" not found`);
    }
    return guardian;
  }

  async update(id: string, dto: UpdateGuardianDto, tenantId: string): Promise<Guardian> {
    await this.findOne(id, tenantId);

    const updateData: any = { ...dto };

    let studentIds: string[] | undefined;
    if (dto.student_ids) {
      studentIds = dto.student_ids;
      delete updateData.student_ids;
    }

    await this.repo.update({ id, tenant_id: tenantId }, updateData);

    if (studentIds !== undefined) {
      const guardian = await this.repo.findOne({
        where: { id },
        relations: ['students'],
      });
      if (guardian) {
        if (studentIds.length > 0) {
          const students = await this.studentRepo.findByIds(studentIds);
          guardian.students = students;
        } else {
          guardian.students = [];
        }
        await this.repo.save(guardian);
      }
    }

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);
    await this.repo.softDelete({ id, tenant_id: tenantId });
  }
}