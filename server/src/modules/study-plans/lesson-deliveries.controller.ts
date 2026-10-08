import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';

/** [66.2.01] Skeleton: a later wave-2 ticket adds the routes. */
@ApiTags('lesson-deliveries')
@ApiTenantAuth()
@Controller('lesson-deliveries')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class LessonDeliveriesController {}
