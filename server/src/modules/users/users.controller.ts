import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { UserService, TeacherService } from './users.service';
import { User } from './entities/user.entity';
import {
  CreateUserDto,
  UpdateUserDto,
  QueryUserDto,
  CreateTeacherDto,
  UpdateTeacherDto,
  QueryTeacherDto,
} from './dto/users.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserRole } from '@beton-boi/shared';

// Explicit `user: UserResponseDto` in the return type — not just at
// runtime — matters here: Swagger's schema generation reads the method's
// *type*, and a generic passthrough that only fixed up the runtime value
// while still structurally typing as `T` (with `T.user: User`) previously
// let the full User entity, password_hash included, leak into the
// generated OpenAPI document as an orphaned schema even though no response
// actually returned it.
function toSafeTeacher<T extends { user: User }>(teacher: T): Omit<T, 'user'> & { user: UserResponseDto } {
  return { ...teacher, user: UserResponseDto.fromEntity(teacher.user) };
}

@ApiTags('users')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly teacherService: TeacherService,
  ) {}

  // --- User endpoints ---

  @Post('users')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  async createUser(
    @Body() dto: CreateUserDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const { user, membership } = await this.userService.create(dto, tenant.id);
    return { user: UserResponseDto.fromEntity(user), membership };
  }

  @Get('users')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  async findAllUsers(
    @Query() query: QueryUserDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const result = await this.userService.findAll(query, tenant.id);
    return { ...result, data: result.data.map(UserResponseDto.fromEntity) };
  }

  @Get('users/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiResponse({ status: 200, type: UserResponseDto })
  async findOneUser(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const user = await this.userService.findOne(id, tenant.id);
    return UserResponseDto.fromEntity(user);
  }

  @Patch('users/:id')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const user = await this.userService.update(id, dto, tenant.id);
    return UserResponseDto.fromEntity(user);
  }

  @Delete('users/:id')
  @Roles(UserRole.ADMIN)
  removeUser(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.userService.remove(id, tenant.id);
  }

  // --- Teacher endpoints ---

  @Post('teachers')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: 'Promote an existing tenant member to a teacher profile.' })
  async createTeacher(
    @Body() dto: CreateTeacherDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const teacher = await this.teacherService.create(dto, tenant.id);
    return toSafeTeacher(teacher);
  }

  @Get('teachers')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  async findAllTeachers(
    @Query() query: QueryTeacherDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const result = await this.teacherService.findAll(query, tenant.id);
    return { ...result, data: result.data.map(toSafeTeacher) };
  }

  @Patch('teachers/:id')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  async updateTeacher(
    @Param('id') id: string,
    @Body() dto: UpdateTeacherDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const teacher = await this.teacherService.update(id, dto, tenant.id);
    return toSafeTeacher(teacher);
  }
}