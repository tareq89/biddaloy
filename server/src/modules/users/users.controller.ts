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
import {
  CreateUserDto,
  UpdateUserDto,
  QueryUserDto,
  CreateTeacherDto,
  UpdateTeacherDto,
  QueryTeacherDto,
} from './dto/users.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { TeacherResponseDto } from './dto/teacher-response.dto';
import { Teacher } from '../academics/entities/teacher.entity';
import { UserRole } from '@beton-boi/shared';

function toSafeTeacher(teacher: Teacher): TeacherResponseDto {
  return TeacherResponseDto.fromEntity(teacher);
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
  removeUser(@Param('id') id: string, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.userService.remove(id, tenant.id);
  }

  // --- Teacher endpoints ---

  @Post('teachers')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: 'Promote an existing tenant member to a teacher profile.' })
  @ApiResponse({ status: 201, type: TeacherResponseDto })
  async createTeacher(
    @Body() dto: CreateTeacherDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const teacher = await this.teacherService.create(dto, tenant.id);
    return toSafeTeacher(teacher);
  }

  @Get('teachers')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @ApiResponse({ status: 200, type: TeacherResponseDto, isArray: true })
  async findAllTeachers(
    @Query() query: QueryTeacherDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const result = await this.teacherService.findAll(query, tenant.id);
    return { ...result, data: result.data.map(toSafeTeacher) };
  }

  @Patch('teachers/:id')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiResponse({ status: 200, type: TeacherResponseDto })
  async updateTeacher(
    @Param('id') id: string,
    @Body() dto: UpdateTeacherDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const teacher = await this.teacherService.update(id, dto, tenant.id);
    return toSafeTeacher(teacher);
  }
}
