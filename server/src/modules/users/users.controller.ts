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
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { UserService, TeacherService } from './users.service';
import {
  CreateUserDto,
  UpdateUserDto,
  QueryUserDto,
  CreateTeacherDto,
  UpdateTeacherDto,
  QueryTeacherDto,
} from './dto/users.dto';
import { UserRole } from '@beton-boi/shared';

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
  createUser(@Body() dto: CreateUserDto) {
    return this.userService.create(dto);
  }

  @Get('users')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findAllUsers(@Query() query: QueryUserDto) {
    return this.userService.findAll(query);
  }

  @Get('users/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findOneUser(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Patch('users/:id')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userService.update(id, dto);
  }

  @Delete('users/:id')
  @Roles(UserRole.ADMIN)
  removeUser(@Param('id') id: string) {
    return this.userService.remove(id);
  }

  // --- Teacher endpoints ---

  @Post('teachers')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  createTeacher(
    @Body() dto: CreateTeacherDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.teacherService.create(dto, tenant.id);
  }

  @Get('teachers')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findAllTeachers(
    @Query() query: QueryTeacherDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.teacherService.findAll(query, tenant.id);
  }

  @Patch('teachers/:id')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  updateTeacher(
    @Param('id') id: string,
    @Body() dto: UpdateTeacherDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.teacherService.update(id, dto, tenant.id);
  }
}