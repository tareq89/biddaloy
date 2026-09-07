import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  NotFoundException,
  Res,
  UnauthorizedException,
  Version,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { HealthService } from './health.service';

/**
 * [15.1.3]: the readiness half of the health surface — see
 * `../../app.controller.ts` for the liveness `/health` route, which stays
 * untouched and never touches DB/Redis.
 *
 * Token-gated because this route, unlike liveness, reveals which backing
 * service is down — genuinely useful to an attacker probing for the
 * weakest link, so it's not left open the way `/health` is. `nginx/`
 * additionally returns a bare 404 for this path so it's not reachable from
 * outside the cluster at all; the token check here is defense in depth for
 * anything that talks to the app container directly.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @SkipThrottle()
  @Version(VERSION_NEUTRAL)
  @Get('ready')
  async ready(
    @Headers('x-health-token') token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expected = process.env.HEALTH_TOKEN;

    // Unset HEALTH_TOKEN means this deployment hasn't opted into the
    // route at all — a genuine 404, not a 401, so its existence isn't
    // even disclosed.
    if (!expected) {
      throw new NotFoundException();
    }
    if (token !== expected) {
      throw new UnauthorizedException();
    }

    const result = await this.healthService.readiness();
    res.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
