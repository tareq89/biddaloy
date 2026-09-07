import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiOkResponse, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtPayload, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { ProvisioningService } from './provisioning.service';
import { ProvisionSchoolDto } from './dto/provision-school.dto';

/**
 * `POST /schools` (#529) — SUPER_ADMIN console: create a school and its
 * first ADMIN atomically. Kept as its own controller (not a method on
 * `SchoolsController`) so this lane's files never overlap with #532's
 * `schools.controller.ts`/`schools.service.ts` stats work landing
 * concurrently on the same branch.
 */
@ApiTags('schools')
@ApiTenantAuth()
@Controller('schools')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ProvisioningController {
  constructor(private readonly provisioning: ProvisioningService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a school and its first ADMIN in one atomic, idempotent request. Replaying the ' +
      'same idempotency_key returns the original result (200) instead of creating a second ' +
      'school/user/invitation.',
  })
  @ApiCreatedResponse({ description: 'School, admin, and invitation created.' })
  @ApiOkResponse({
    description: 'Replayed: an identical request with this idempotency_key already succeeded.',
  })
  async provision(
    @Body() dto: ProvisionSchoolDto,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { result, replayed } = await this.provisioning.provision(dto, user.sub);
    if (replayed) {
      res.status(HttpStatus.OK);
    }
    return result;
  }
}
