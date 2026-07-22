import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import {
  CreateUserDto,
  UpdateUserDto,
  QueryUserDto,
  CreateTeacherDto,
  UpdateTeacherDto,
  QueryTeacherDto,
} from './dto/users.dto';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
  ) {}

  async create(dto: CreateUserDto, tenantId: string): Promise<{ user: User; membership: UserTenant }> {
    // Check for duplicate email
    if (dto.email) {
      const existing = await this.userRepo.findOne({ where: { email: dto.email } });
      if (existing) {
        throw new ConflictException(`User with email "${dto.email}" already exists`);
      }
    }

    let password_hash: string | null = null;
    if (dto.password) {
      password_hash = await bcrypt.hash(dto.password, 10);
    }

    return this.userRepo.manager.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const userTenantRepo = manager.getRepository(UserTenant);

      const user = userRepo.create({
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        password_hash,
        full_name: dto.full_name,
      });
      const savedUser = await userRepo.save(user);

      const membership = userTenantRepo.create({
        user_id: savedUser.id,
        tenant_id: tenantId,
        role: dto.role,
      });
      const savedMembership = await userTenantRepo.save(membership);

      return { user: savedUser, membership: savedMembership };
    });
  }

  async findAll(query: QueryUserDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const qb = this.userRepo.createQueryBuilder('u')
      .innerJoinAndSelect('u.user_tenants', 'ut')
      .where('u.deleted_at IS NULL')
      .andWhere('ut.tenant_id = :tenantId', { tenantId });

    if (query.role) {
      qb.andWhere('ut.role = :role', { role: query.role });
    }

    const total = await qb.getCount();
    qb.orderBy('u.created_at', 'DESC').skip(skip).take(limit);
    const data = await qb.getMany();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, tenantId: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id, deleted_at: IsNull() },
      relations: ['user_tenants'],
    });
    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    // Verify user has a membership in this tenant
    const membership = user.user_tenants?.find(
      (ut) => ut.tenant_id === tenantId,
    );
    if (!membership) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    return user;
  }

  async update(id: string, dto: UpdateUserDto, tenantId: string): Promise<User> {
    await this.findOne(id, tenantId);

    // Update user-level fields (shared across tenants)
    const updateData: any = {};
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.full_name !== undefined) updateData.full_name = dto.full_name;
    if (dto.profile_picture_url !== undefined) updateData.profile_picture_url = dto.profile_picture_url;
    if (Object.keys(updateData).length > 0) {
      await this.userRepo.update({ id }, updateData);
    }

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);

    // Remove only the tenant membership, not the global user record
    await this.userTenantRepo.delete({ user_id: id, tenant_id: tenantId });
  }
}

@Injectable()
export class TeacherService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    @InjectRepository(Teacher)
    private readonly teacherRepo: Repository<Teacher>,
    @InjectRepository(TeacherClassSection)
    private readonly tcsRepo: Repository<TeacherClassSection>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
  ) {}

  async create(dto: CreateTeacherDto, tenantId: string): Promise<Teacher> {
    const user = await this.userRepo.findOne({
      where: { id: dto.user_id, deleted_at: IsNull() },
    });
    if (!user) {
      throw new NotFoundException(`User with ID "${dto.user_id}" not found`);
    }

    // Verify user is a member of this tenant
    const membership = await this.userTenantRepo.findOne({
      where: { user_id: dto.user_id, tenant_id: tenantId },
    });
    if (!membership) {
      throw new BadRequestException(
        `User "${dto.user_id}" is not a member of this tenant`,
      );
    }

    // Check for duplicate employee_id
    const existing = await this.teacherRepo.findOne({
      where: { employee_id: dto.employee_id },
    });
    if (existing) {
      throw new ConflictException(
        `Teacher with employee ID "${dto.employee_id}" already exists`,
      );
    }

    const teacher = this.teacherRepo.create({
      user_id: dto.user_id,
      employee_id: dto.employee_id,
      designations: dto.designations ?? [],
      subject_specialization: dto.subject_specialization ?? null,
      joining_date: dto.joining_date ? new Date(dto.joining_date) : null,
      tenant_id: tenantId,
    });
    const savedTeacher = await this.teacherRepo.save(teacher);

    // Assign sections if provided
    if (dto.assigned_section_ids?.length) {
      // Validate all sections belong to tenant
      const sectionCount = await this.sectionRepo.count({
        where: {
          id: In(dto.assigned_section_ids),
          tenant_id: tenantId,
          deleted_at: IsNull(),
        },
      });
      if (sectionCount !== dto.assigned_section_ids.length) {
        throw new NotFoundException('One or more assigned sections not found');
      }

      const tcsEntries = dto.assigned_section_ids.map((sectionId) =>
        this.tcsRepo.create({
          teacher_id: savedTeacher.id,
          section_id: sectionId,
        }),
      );
      await this.tcsRepo.save(tcsEntries);
    }

    return this.teacherRepo.findOne({
      where: { id: savedTeacher.id },
      relations: ['user'],
    }) as Promise<Teacher>;
  }

  async findAll(query: QueryTeacherDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const qb = this.teacherRepo.createQueryBuilder('t')
      .leftJoinAndSelect('t.user', 'u')
      .where('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.deleted_at IS NULL');

    if (query.search) {
      qb.andWhere('u.full_name ILIKE :search', { search: `%${query.search}%` });
    }

    const total = await qb.getCount();
    qb.orderBy('t.created_at', 'DESC').skip(skip).take(limit);
    const data = await qb.getMany();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<Teacher> {
    const teacher = await this.teacherRepo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['user'],
    });
    if (!teacher) {
      throw new NotFoundException(`Teacher with ID "${id}" not found`);
    }
    return teacher;
  }

  async update(id: string, dto: UpdateTeacherDto, tenantId: string): Promise<Teacher> {
    await this.findOne(id, tenantId);

    const updateData: any = {};
    if (dto.employee_id !== undefined) updateData.employee_id = dto.employee_id;
    if (dto.designations !== undefined) updateData.designations = dto.designations;
    if (dto.subject_specialization !== undefined) updateData.subject_specialization = dto.subject_specialization;
    if (dto.joining_date !== undefined) updateData.joining_date = new Date(dto.joining_date);

    await this.teacherRepo.update({ id, tenant_id: tenantId }, updateData);

    // Replace assigned sections if provided
    if (dto.assigned_section_ids !== undefined) {
      await this.tcsRepo.delete({ teacher_id: id });

      if (dto.assigned_section_ids.length > 0) {
        // Validate all sections belong to tenant
        const sectionCount = await this.sectionRepo.count({
          where: {
            id: In(dto.assigned_section_ids),
            tenant_id: tenantId,
            deleted_at: IsNull(),
          },
        });
        if (sectionCount !== dto.assigned_section_ids.length) {
          throw new NotFoundException('One or more assigned sections not found');
        }

        const tcsEntries = dto.assigned_section_ids.map((sectionId) =>
          this.tcsRepo.create({
            teacher_id: id,
            section_id: sectionId,
          }),
        );
        await this.tcsRepo.save(tcsEntries);
      }
    }

    return this.teacherRepo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['user'],
    }) as Promise<Teacher>;
  }
}