import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, Like } from 'typeorm';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { CreateStudentDto, UpdateStudentDto, QueryStudentDto } from './dto/students.dto';
import { CreateGuardianDto, UpdateGuardianDto, QueryGuardianDto } from './dto/students.dto';
import { CommunicationMedium } from '@beton-boi/shared';

@Injectable()
export class StudentService {
  constructor(
    @InjectRepository(Student)
    private readonly repo: Repository<Student>,
    @InjectRepository(Guardian)
    private readonly guardianRepo: Repository<Guardian>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
  ) {}

  async create(dto: CreateStudentDto, tenantId: string): Promise<Student> {
    // Validate class_section_id belongs to tenant
    const section = await this.sectionRepo.findOne({
      where: { id: dto.class_section_id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['class'],
    });
    if (!section) {
      throw new NotFoundException(`Class section with ID "${dto.class_section_id}" not found`);
    }

    // Guard validations
    if (dto.guardian_ids?.length) {
      const guardianCount = await this.guardianRepo.count({
        where: { id: In(dto.guardian_ids), tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (guardianCount !== dto.guardian_ids.length) {
        throw new NotFoundException('One or more guardian IDs not found');
      }
    }

    // Generate registration number atomically
    const currentYear = new Date().getFullYear();
    const regNumber = await this.repo.manager.transaction(async (manager) => {
      const studentRepo = manager.getRepository(Student);

      const lastStudent = await studentRepo
        .createQueryBuilder('s')
        .where('s.tenant_id = :tenantId', { tenantId })
        .andWhere('s.registration_number LIKE :pattern', { pattern: `REG-${currentYear}-%` })
        .orderBy('s.registration_number', 'DESC')
        .setLock('pessimistic_write')
        .getOne();

      let nextSeq = 1;
      if (lastStudent) {
        const parts = lastStudent.registration_number.split('-');
        const lastSeq = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastSeq)) {
          nextSeq = lastSeq + 1;
        }
      }

      return `REG-${currentYear}-${String(nextSeq).padStart(4, '0')}`;
    });

    // Get next roll number for this section
    const lastRoll = await this.repo.findOne({
      where: { class_section_id: dto.class_section_id, tenant_id: tenantId, deleted_at: IsNull() },
      order: { roll_number: 'DESC' },
    });
    const rollNumber = dto.roll_number ?? (lastRoll ? lastRoll.roll_number + 1 : 1);

    const student = this.repo.create({
      full_name: dto.full_name,
      registration_number: regNumber,
      roll_number: rollNumber,
      class_section_id: dto.class_section_id,
      date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : new Date(),
      gender: dto.gender ?? null,
      home_address: dto.home_address ?? null,
      preferred_communication: dto.preferred_communication as CommunicationMedium,
      tenant_id: tenantId,
    });

    const savedStudent = await this.repo.save(student);

    // Link guardians
    if (dto.guardian_ids?.length) {
      const guardians = await this.guardianRepo.find({
        where: { id: In(dto.guardian_ids), tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (guardians.length !== dto.guardian_ids.length) {
        throw new NotFoundException('One or more guardian IDs not found');
      }
      savedStudent.guardians = guardians;
      await this.repo.save(savedStudent);
    }

    return this.repo.findOne({
      where: { id: savedStudent.id },
      relations: ['class_section', 'class_section.class', 'guardians'],
    }) as Promise<Student>;
  }

  async findAll(query: QueryStudentDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = { tenant_id: tenantId, deleted_at: IsNull() };

    if (query.class_id) where.class_section_id = query.class_id;
    if (query.section_id) where.section_id = query.section_id;
    if (query.enrollment_status) where.enrollment_status = query.enrollment_status;

    const [data, total] = await this.repo.findAndCount({
      where,
      relations: ['class_section', 'class_section.class', 'guardians'],
      order: { created_at: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<Student> {
    const student = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['class_section', 'class_section.class', 'guardians'],
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${id}" not found`);
    }
    return student;
  }

  async update(id: string, dto: UpdateStudentDto, tenantId: string): Promise<Student> {
    await this.findOne(id, tenantId);

    // Validate class_section_id belongs to tenant if provided
    if (dto.class_section_id) {
      const section = await this.sectionRepo.findOne({
        where: { id: dto.class_section_id, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!section) {
        throw new NotFoundException(`Class section with ID "${dto.class_section_id}" not found`);
      }
    }

    const updateData: any = { ...dto };
    if (dto.date_of_birth) {
      updateData.date_of_birth = new Date(dto.date_of_birth);
    }
    if (dto.guardian_ids !== undefined) {
      delete updateData.guardian_ids;
    }

    await this.repo.update({ id, tenant_id: tenantId }, updateData);

    // Replace guardian links if provided
    if (dto.guardian_ids !== undefined) {
      const student = await this.findOne(id, tenantId);
      if (dto.guardian_ids.length > 0) {
        const guardians = await this.guardianRepo.find({
          where: { id: In(dto.guardian_ids), tenant_id: tenantId, deleted_at: IsNull() },
        });
        if (guardians.length !== dto.guardian_ids.length) {
          throw new NotFoundException('One or more guardian IDs not found');
        }
        student.guardians = guardians;
      } else {
        student.guardians = [];
      }
      await this.repo.save(student);
    }

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);
    await this.repo.softDelete({ id, tenant_id: tenantId });
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
    const entity = this.repo.create({
      full_name: dto.full_name,
      relationship: dto.relationship ?? 'OTHER',
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      alternate_phone: dto.alternate_phone ?? null,
      address: dto.address ?? null,
      occupation: dto.occupation ?? null,
      preferred_communication: dto.preferred_communication,
      tenant_id: tenantId,
    });

    const saved = await this.repo.save(entity);

    // Link students if provided
    if (dto.student_ids?.length) {
      const students = await this.studentRepo.find({
        where: { id: In(dto.student_ids), tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (students.length !== dto.student_ids.length) {
        throw new NotFoundException('One or more student IDs not found');
      }
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
      const search = `%${query.search}%`;
      return this.repo.findAndCount({
        where: [
          { ...where, full_name: Like(search) },
          { ...where, phone: Like(search) },
          { ...where, email: Like(search) },
        ],
        order: { created_at: 'DESC' },
        skip,
        take: limit,
      }).then(([data, total]) => ({
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }));
    }

    const [data, total] = await this.repo.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<Guardian> {
    const guardian = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['students'],
    });
    if (!guardian) {
      throw new NotFoundException(`Guardian with ID "${id}" not found`);
    }
    return guardian;
  }

  async update(id: string, dto: UpdateGuardianDto, tenantId: string): Promise<Guardian> {
    await this.findOne(id, tenantId);

    const updateData: any = { ...dto };
    if (dto.student_ids !== undefined) {
      delete updateData.student_ids;
    }

    await this.repo.update({ id, tenant_id: tenantId }, updateData);

    // Replace student links if provided
    if (dto.student_ids !== undefined) {
      const guardian = await this.findOne(id, tenantId);
      if (dto.student_ids.length > 0) {
        const students = await this.studentRepo.find({
          where: { id: In(dto.student_ids), tenant_id: tenantId, deleted_at: IsNull() },
        });
        if (students.length !== dto.student_ids.length) {
          throw new NotFoundException('One or more student IDs not found');
        }
        guardian.students = students;
      } else {
        guardian.students = [];
      }
      await this.repo.save(guardian);
    }

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);
    await this.repo.softDelete({ id, tenant_id: tenantId });
  }
}