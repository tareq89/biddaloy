import express from 'express';
import supertest = require('supertest');
import { describe, expect, it } from 'vitest';

import { runtimeConfigHandler } from './runtime-config';

describe('GET /runtime-config.js', () => {
  const app = express();
  app.get('/runtime-config.js', runtimeConfigHandler({ SENTRY_ENVIRONMENT: 'staging' }));

  it('serves no-store JavaScript that sets the config global', async () => {
    const res = await supertest(app).get('/runtime-config.js').expect(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text.startsWith('window.__BIDDALOY_CONFIG__=')).toBe(true);
    expect(res.text).toContain('"sentryEnvironment":"staging"');
  });
});
