import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';

/** [66.2.01] Skeleton: a later wave-2 ticket adds the family routes under `students/:id/...`. */
@ApiTags('family-study-plans')
@ApiTenantAuth()
@Controller('students')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class FamilyStudyPlansController {}
