import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";

@Controller()
export class AppController {
  // Exempt from rate limiting — the orchestrator polls this on a fixed
  // interval and must not be throttled into a false-unhealthy verdict.
  @SkipThrottle()
  @Get("health")
  health() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}