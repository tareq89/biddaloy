import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PUBLIC_VERIFY_RATE_LIMIT } from '../../../rate-limit';
import { PublicVerifyService } from './public-verify.service';

/** [32.2.5] Public, unauthenticated: the page a printed QR code opens. */
@ApiTags('public-verify')
@Controller('public/verify')
export class PublicVerifyController {
  constructor(private readonly service: PublicVerifyService) {}

  @Get(':token')
  @Throttle({ default: PUBLIC_VERIFY_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Check a printed document by its QR token. No auth, no tenant header. Returns only kind, holder, school, issue date, copy number and VALID/REVOKED; 404 for an unknown token.',
  })
  verify(@Param('token') token: string) {
    return this.service.verify(token);
  }
}
