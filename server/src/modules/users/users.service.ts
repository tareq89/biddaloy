import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Like } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
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

  async create(dto: CreateUserDto): Promise<{ user: User; membership: UserTenant }> {
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

    const user = this.userRepo.create({
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      password_hash,
      full_name: dto.full_name,
    });
    const savedUser = await this.userRepo.save(user);

    // Create membership in the tenant
    const membership = this.userTenantRepo.create({
      user_id: savedUser.id,
      tenant_id: dto.tenantId,
      role: dto.role,
    });
    const savedMembership = await this.userTenantRepo.save(membership);

    return { user: savedUser, membership: savedMembership };
  }

  async findAll(query: QueryUserDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = { deleted_at: IsNull() };

    const [data, total] = await this.userRepo.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip,
      take: limit,
    });

    // If role filter is provided, fetch memberships in batch
    let result = data;
    if (query.role) {
      const userIds = data.map((u) => u.id);
      const memberships = await this.userTenantRepo.find({
        where: userIds.map((uid) => ({ user_id: uid, role: query.role })),
      });
      const userIdsWithRole = new Set(memberships.map((m) => m.user_id));
      result = data.filter((u) => userIdsWithRole.has(u.id));
    }

    return {
      data: result,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id, deleted_at: IsNull() },
    });
    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    await this.findOne(id);
    await this.userRepo.update({ id }, dto);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.userRepo.softDelete({ id });
  }
}

@Injectable()
export class TeacherService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Teacher)
    private readonly teacherRepo: Repository<Teacher>,
    @InjectRepository(TeacherClassSection)
    private readonly tcsRepo: Repository<TeacherClassSection>,
  ) {}

  async create(dto: CreateTeacherDto, tenantId: string): Promise<Teacher> {
    const user = await this.userRepo.findOne({
      where: { id: dto.user_id, deleted_at: IsNull() },
    });
    if (!user) {
      throw new NotFoundException(`User with ID "${dto.user_id}" not found`);
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

    const where: any = { tenant_id: tenantId, deleted_at: IsNull() };

    const [data, total] = await this.teacherRepo.findAndCount({
      where,
      relations: ['user'],
      order: { created_at: 'DESC' },
      skip,
      take: limit,
    });

    // Filter by name search if provided
    let result = data;
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      result = data.filter((t) =>
        t.user?.full_name?.toLowerCase().includes(searchLower),
      );
    }

    return {
      data: result,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
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