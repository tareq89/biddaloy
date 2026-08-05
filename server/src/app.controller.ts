import { Controller, Get, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@Controller()
export class AppController {
  // Exempt from rate limiting — the orchestrator polls this on a fixed
  // interval and must not be throttled into a false-unhealthy verdict.
  // Version-neutral so it stays at a stable /api/health regardless of API
  // version bumps — the orchestrator shouldn't need to track those.
  @SkipThrottle()
  @Version(VERSION_NEUTRAL)
  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
