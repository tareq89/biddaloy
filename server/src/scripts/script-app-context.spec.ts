import { afterEach, describe, expect, it, vi } from 'vitest';

// What `QUEUE_WORKERS_DISABLED` held at the moment `app.module` was
// evaluated — that is when `BullModule.forRootAsync` reads it.
const seen = vi.hoisted(() => ({ flagAtAppModuleLoad: undefined as string | undefined }));

vi.mock('../app.module', () => {
  seen.flagAtAppModuleLoad = process.env.QUEUE_WORKERS_DISABLED;
  return { AppModule: class AppModule {} };
});

vi.mock('@nestjs/core', () => ({
  NestFactory: { createApplicationContext: vi.fn().mockResolvedValue({ fake: 'context' }) },
}));

import { NestFactory } from '@nestjs/core';
import { createScriptAppContext, QUEUE_WORKERS_DISABLED_ENV } from './script-app-context';

describe('createScriptAppContext', () => {
  afterEach(() => {
    delete process.env[QUEUE_WORKERS_DISABLED_ENV];
  });

  it('turns BullMQ workers off BEFORE AppModule is loaded', async () => {
    const context = await createScriptAppContext();

    // If the flag were set after app.module loaded, BullModule would already
    // have captured `manualRegistration: false` and the script would start
    // workers that pull jobs off a shared Redis.
    expect(seen.flagAtAppModuleLoad).toBe('true');
    expect(NestFactory.createApplicationContext).toHaveBeenCalledTimes(1);
    expect(context).toEqual({ fake: 'context' });
  });
});
