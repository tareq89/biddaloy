import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { RefreshTokenService } from './refresh-token.service';
import { REFRESH_TOKEN_CLEANUP_QUEUE } from './refresh-token-cleanup.constants';

@Processor(REFRESH_TOKEN_CLEANUP_QUEUE)
export class RefreshTokenCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(RefreshTokenCleanupProcessor.name);

  constructor(private readonly refreshTokenService: RefreshTokenService) {
    super();
  }

  async process(): Promise<void> {
    const deleted = await this.refreshTokenService.cleanupExpired();
    if (deleted > 0) {
      this.logger.log(`Cleaned up ${deleted} expired refresh token(s)`);
    }
  }
}
