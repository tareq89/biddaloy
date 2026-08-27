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
  UseInterceptors,
  UploadedFile,
  Inject,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { StudentService, GuardianService } from './students.service';
import { StudentBulkUploadService } from './bulk-upload.service';
import { FamilyAccessService } from './family-access.service';
import {
  CreateStudentDto,
  UpdateStudentDto,
  QueryStudentDto,
  CreateGuardianDto,
  UpdateGuardianDto,
  UpdateOwnGuardianDto,
  QueryGuardianDto,
} from './dto/students.dto';
import { UserRole, JwtPayload } from '@biddaloy/shared';

const BULK_UPLOAD_MAX_FILE_SIZE = 5 * 1024 * 1024;

@ApiTags('students')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
export class StudentController {
  constructor(
    @Inject(StudentService) private readonly studentService: StudentService,
    @Inject(GuardianService) private readonly guardianService: GuardianService,
    @Inject(StudentBulkUploadService) private readonly bulkUploadService: StudentBulkUploadService,
    @Inject(FamilyAccessService) private readonly familyAccess: FamilyAccessService,
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

  @Post('students/bulk-upload')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: BULK_UPLOAD_MAX_FILE_SIZE } }))
  @ApiOperation({
    summary: 'Bulk-create students and their guardians from a CSV/XLSX spreadsheet (max 5MB).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  bulkUploadStudents(
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bulkUploadService.process(file, tenant.id, user.sub);
  }

  @Get('students')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findAllStudents(
    @Query() query: QueryStudentDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.studentService.findAll(query, tenant.id);
  }

  /**
   * MUST stay declared above `students/:id` — that route has no
   * `ParseUUIDPipe` on its param, so Nest (which matches in declaration
   * order) would otherwise capture `mine` as a student id and 404. [5.1]
   */
  @Get('students/mine')
  @Roles(UserRole.PARENT, UserRole.STUDENT)
  @ApiOperation({
    summary:
      "List the students the calling PARENT or STUDENT is linked to. The discovery route for the family portal: without it a parent has no way to learn their own children's IDs.",
  })
  findMyStudents(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.familyAccess.getLinkedStudents(tenant.role, user.sub, tenant.id);
  }

  @Get('students/:id')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  @ApiOperation({
    summary:
      "Get a single student. A PARENT or STUDENT caller additionally must be linked to this specific student — role alone isn't enough.",
  })
  async findOneStudent(
    @Param('id') id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const student = await this.studentService.findOne(id, tenant.id);
    // Object-level authorization for PARENT/STUDENT; a no-op for staff.
    // [5.1] moved the check that used to be inline here into
    // FamilyAccessService so every widened family route shares one copy.
    await this.familyAccess.assertLinked(tenant.role, user.sub, id, tenant.id);
    return student;
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
  removeStudent(@Param('id') id: string, @CurrentTenant() tenant: { id: string; role: string }) {
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

  /**
   * MUST stay declared above `guardians/:id` (PATCH has a bare
   * `@Param('id')`, so `mine` would be captured as an id). [5.4a]
   *
   * PARENT only: STUDENT accounts link through `students.user_id`, not a
   * guardian row, so they get a 403 rather than a guaranteed 404.
   */
  @Get('guardians/mine')
  @Roles(UserRole.PARENT)
  @ApiOperation({
    summary:
      "Read the guardian record linked to the calling PARENT's own account. Ownership comes from the JWT, never a path id.",
  })
  findMyGuardian(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guardianService.findOwn(user.sub, tenant.id);
  }

  /** See the ordering note on `GET guardians/mine`. */
  @Patch('guardians/mine')
  @Roles(UserRole.PARENT)
  @ApiOperation({
    summary:
      "Update the contact details on the calling PARENT's own guardian record. These are the fields fee reminders dial, so a stale number is self-fixable.",
  })
  updateMyGuardian(
    @Body() dto: UpdateOwnGuardianDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guardianService.updateOwn(user.sub, dto, tenant.id);
  }

  @Get('guardians/:id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  findOneGuardian(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.guardianService.findOne(id, tenant.id);
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
  removeGuardian(@Param('id') id: string, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.guardianService.remove(id, tenant.id);
  }
}
