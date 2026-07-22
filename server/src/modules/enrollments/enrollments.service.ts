import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { CreateEnrollmentDto, UpdateEnrollmentDto } from './dto/enrollments.dto';
import { EnrollmentStatus } from '@beton-boi/shared';

@Injectable()
export class EnrollmentService {
  constructor(
    @InjectRepository(Enrollment)
    private readonly repo: Repository<Enrollment>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
  ) {}

  async create(dto: CreateEnrollmentDto, tenantId: string): Promise<Enrollment> {
    // Verify student exists and belongs to tenant via class_section -> class chain
    const student = await this.studentRepo.findOne({
      where: { id: dto.student_id, deleted_at: IsNull() },
      relations: ['class_section', 'class_section.class'],
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${dto.student_id}" not found`);
    }
    if (student.class_section?.class?.tenant_id !== tenantId) {
      throw new NotFoundException(`Student with ID "${dto.student_id}" not found`);
    }

    // Verify class belongs to tenant
    const cls = await this.classRepo.findOne({
      where: { id: dto.class_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!cls) {
      throw new NotFoundException(`Class with ID "${dto.class_id}" not found`);
    }

    // Verify academic year exists for tenant
    const academicYear = await this.academicYearRepo.findOne({
      where: { id: dto.academic_year_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!academicYear) {
      throw new NotFoundException(`Academic year with ID "${dto.academic_year_id}" not found`);
    }

    // Verify section exists and belongs to tenant/class when provided
    if (dto.section_id) {
      const section = await this.sectionRepo.findOne({
        where: { id: dto.section_id, class_id: dto.class_id, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!section) {
        throw new NotFoundException(`Section with ID "${dto.section_id}" not found in this class`);
      }
    }

    // Check for duplicate active enrollment
    const existing = await this.repo.findOne({
      where: {
        student_id: dto.student_id,
        academic_year_id: dto.academic_year_id,
        enrollment_status: EnrollmentStatus.ACTIVE,
      },
    });
    if (existing) {
      throw new ConflictException(
        `Student is already actively enrolled in academic year "${dto.academic_year_id}"`,
      );
    }

    const entity = this.repo.create({
      student_id: dto.student_id,
      class_id: dto.class_id,
      section_id: dto.section_id ?? null,
      academic_year_id: dto.academic_year_id,
      tenant_id: tenantId,
    });

    return this.repo.save(entity);
  }

  async findByStudent(studentId: string, tenantId: string) {
    // Verify student exists and belongs to tenant
    const student = await this.studentRepo.findOne({
      where: { id: studentId, deleted_at: IsNull() },
      relations: ['class_section', 'class_section.class'],
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }
    if (student.class_section?.class?.tenant_id !== tenantId) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }

    return this.repo.find({
      where: { student_id: studentId, tenant_id: tenantId },
      relations: ['class', 'section', 'academic_year'],
      order: { enrolled_at: 'DESC' },
    });
  }

  async findCurrentByStudent(studentId: string, tenantId: string): Promise<Enrollment | null> {
    // Verify student exists and belongs to tenant
    const student = await this.studentRepo.findOne({
      where: { id: studentId, deleted_at: IsNull() },
      relations: ['class_section', 'class_section.class'],
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }
    if (student.class_section?.class?.tenant_id !== tenantId) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }

    return this.repo.findOne({
      where: {
        student_id: studentId,
        tenant_id: tenantId,
        enrollment_status: EnrollmentStatus.ACTIVE,
      },
      relations: ['class', 'section', 'academic_year'],
    });
  }

  async update(id: string, dto: UpdateEnrollmentDto, tenantId: string): Promise<Enrollment> {
    const enrollment = await this.repo.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['class', 'section'],
    });
    if (!enrollment) {
      throw new NotFoundException(`Enrollment with ID "${id}" not found`);
    }

    // Verify the enrollment's class belongs to this tenant
    if (enrollment.class.tenant_id !== tenantId) {
      throw new NotFoundException(`Enrollment with ID "${id}" not found`);
    }

    // Validate section_id if provided
    if (dto.section_id) {
      const section = await this.sectionRepo.findOne({
        where: { id: dto.section_id, class_id: enrollment.class_id, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!section) {
        throw new NotFoundException(`Section with ID "${dto.section_id}" not found in this class`);
      }
    }

    await this.repo.update({ id, tenant_id: tenantId }, dto);
    return this.repo.findOne({
      where: { id },
      relations: ['class', 'section', 'academic_year'],
    }) as Promise<Enrollment>;
  }
}