import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { JwtPayload } from '@biddaloy/shared';
import { PlatformAccessGuard } from '../../platform-identity/platform-access.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
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
@ApiBearerAuth('bearer')
@Controller('platform/schools')
@UseGuards(AuthGuard(['jwt', 'cockpit-jwt']), PlatformAccessGuard)
export class ProvisioningController {
  constructor(private readonly provisioning: ProvisioningService) {}

  @Post()
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
    // provision() rethrows non-slug unique violations raw (registration maps them to
    // CONTACT_IN_USE); here they are the console's 409, never a 500.
    const { result, replayed } = await this.provisioning.provision(dto, user.sub).catch((err) => {
      if (err instanceof QueryFailedError && (err as { code?: string }).code === '23505') {
        throw new ConflictException('A user with this email or phone already exists');
      }
      throw err;
    });
    if (replayed) {
      res.status(HttpStatus.OK);
    }
    return result;
  }
}
