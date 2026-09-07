import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

function fakeResponse() {
  return { status: vi.fn() } as any;
}

describe('HealthController.ready', () => {
  const originalToken = process.env.HEALTH_TOKEN;

  afterEach(() => {
    process.env.HEALTH_TOKEN = originalToken;
  });

  it('returns 404 when HEALTH_TOKEN is unset', async () => {
    delete process.env.HEALTH_TOKEN;
    const controller = new HealthController({} as HealthService);

    await expect(controller.ready('anything', fakeResponse())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns 401 when the token does not match', async () => {
    process.env.HEALTH_TOKEN = 'correct-token';
    const controller = new HealthController({} as HealthService);

    await expect(controller.ready('wrong-token', fakeResponse())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns 200 with all-ok checks when every dependency is healthy', async () => {
    process.env.HEALTH_TOKEN = 'correct-token';
    const healthService = {
      readiness: vi.fn().mockResolvedValue({
        status: 'ok',
        checks: { db: 'ok', redis: 'ok', queue: 'ok' },
      }),
    } as unknown as HealthService;
    const controller = new HealthController(healthService);
    const res = fakeResponse();

    const body = await controller.ready('correct-token', res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(body).toEqual({ status: 'ok', checks: { db: 'ok', redis: 'ok', queue: 'ok' } });
  });

  it('returns 503 when a dependency fails, and the body carries no error text', async () => {
    process.env.HEALTH_TOKEN = 'correct-token';
    const healthService = {
      readiness: vi.fn().mockResolvedValue({
        status: 'fail',
        checks: { db: 'ok', redis: 'fail', queue: 'ok' },
      }),
    } as unknown as HealthService;
    const controller = new HealthController(healthService);
    const res = fakeResponse();

    const body = await controller.ready('correct-token', res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(body).toEqual({ status: 'fail', checks: { db: 'ok', redis: 'fail', queue: 'ok' } });
  });
});
