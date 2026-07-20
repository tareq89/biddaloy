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
import { StudentService, GuardianService } from './students.service';
import {
  CreateStudentDto,
  UpdateStudentDto,
  QueryStudentDto,
  CreateGuardianDto,
  UpdateGuardianDto,
  QueryGuardianDto,
} from './dto/students.dto';
import { UserRole } from '@beton-boi/shared';

@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class StudentController {
  constructor(
    private readonly studentService: StudentService,
    private readonly guardianService: GuardianService,
  ) {}

  // --- Student endpoints ---

  @Post('students')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  createStudent(
    @Body() dto: CreateStudentDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.studentService.create(dto, tenant.id);
  }

  @Get('students')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findAllStudents(
    @Query() query: QueryStudentDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.studentService.findAll(query, tenant.id);
  }

  @Get('students/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER, UserRole.PARENT, UserRole.STUDENT)
  findOneStudent(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.studentService.findOne(id, tenant.id);
  }

  @Patch('students/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  updateStudent(
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.studentService.update(id, dto, tenant.id);
  }

  @Delete('students/:id')
  @Roles(UserRole.ADMIN)
  removeStudent(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.studentService.remove(id, tenant.id);
  }

  // --- Guardian endpoints ---

  @Post('guardians')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  createGuardian(
    @Body() dto: CreateGuardianDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.guardianService.create(dto, tenant.id);
  }

  @Get('guardians')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findAllGuardians(
    @Query() query: QueryGuardianDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.guardianService.findAll(query, tenant.id);
  }

  @Patch('guardians/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  updateGuardian(
    @Param('id') id: string,
    @Body() dto: UpdateGuardianDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.guardianService.update(id, dto, tenant.id);
  }

  @Delete('guardians/:id')
  @Roles(UserRole.ADMIN)
  removeGuardian(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.guardianService.remove(id, tenant.id);
  }
}