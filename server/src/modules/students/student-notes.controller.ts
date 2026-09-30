import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload, Permission, UserRole } from '@biddaloy/shared';
import { requestContext } from '../../common/request-context.util';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StudentNotesService } from './student-notes.service';
import { CreateStudentNoteDto, StudentNoteResponseDto } from './dto/student-notes.dto';

type Tenant = { id: string; role: string };

/** [39.2.1] Staff-only (D4): PARENT/STUDENT are excluded by @Roles. */
@ApiTags('student-notes')
@ApiTenantAuth()
@Controller('students')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER)
export class StudentNotesController {
  constructor(@Inject(StudentNotesService) private readonly service: StudentNotesService) {}

  private caller(user: JwtPayload, tenant: Tenant) {
    return { userId: user.sub, role: tenant.role, tenantId: tenant.id };
  }

  @Get(':id/notes')
  @RequirePermissions(Permission.STUDENT_NOTES_READ)
  @ApiOkResponse({ type: [StudentNoteResponseDto] })
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.list(id, this.caller(user, tenant));
  }

  @Post(':id/notes')
  @RequirePermissions(Permission.STUDENT_NOTES_WRITE)
  @ApiCreatedResponse({ type: StudentNoteResponseDto })
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateStudentNoteDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.create(id, dto, this.caller(user, tenant), requestContext(request));
  }

  @Delete(':id/notes/:noteId')
  @HttpCode(204)
  @RequirePermissions(Permission.STUDENT_NOTES_WRITE)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.remove(id, noteId, this.caller(user, tenant), requestContext(request));
  }
}
