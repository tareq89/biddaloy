import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import request = require('supertest');
import { AppModule } from './app.module';
import { buildSwaggerDocumentConfig, shouldMountDocs, DOCS_PATH } from './swagger';
import { buildDocsBasicAuthMiddleware } from './docs-auth';
import { buildVersioningOptions } from './api-versioning';

/**
 * E2E tests for the Swagger docs gating policy main.ts implements.
 *
 * main.ts's bootstrap() never runs under the Nest testing harness, so this
 * replicates just the orchestration (the if/else around mounting) — reusing
 * the actual shouldMountDocs/buildDocsBasicAuthMiddleware/
 * buildSwaggerDocumentConfig helpers bootstrap calls, the same pattern
 * security-headers.e2e-spec.ts and trust-proxy.e2e-spec.ts use. Each test
 * passes its own nodeEnv to these helpers directly rather than mutating
 * process.env.NODE_ENV — that only steers the docs-mounting decision here,
 * without also flipping the rest of the app (rate limiting, login lockout)
 * into production behavior, which isn't what these tests are about.
 */
async function createApp(opts: {
  nodeEnv: string | undefined;
  enableApiDocs?: string;
  docsUser?: string;
  docsPassword?: string;
}): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableVersioning(buildVersioningOptions());

  if (shouldMountDocs(opts.nodeEnv, opts.enableApiDocs)) {
    if (opts.nodeEnv === 'production' && opts.docsUser && opts.docsPassword) {
      // No path argument — see main.ts's comment on the same call for why
      // (app.use('/api/docs', ...) would not also cover /api/docs-json).
      app.use(buildDocsBasicAuthMiddleware(`/api/${DOCS_PATH}`, opts.docsUser, opts.docsPassword));
    }
    const document = SwaggerModule.createDocument(app, buildSwaggerDocumentConfig());
    SwaggerModule.setup(DOCS_PATH, app, document, { useGlobalPrefix: true });
  }

  await app.init();
  return app;
}

describe('Swagger docs gating E2E', () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for swagger-gating E2E tests — see server/.env.test');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
  }, 60000);

  describe('development', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createApp({ nodeEnv: 'development' });
    }, 60000);

    afterAll(async () => {
      await app.close();
    });

    it('is reachable, unauthenticated', async () => {
      await request(app.getHttpServer()).get('/api/docs').expect(200);
    });

    // Regression guard: the docs-generation orchestration (here and in
    // scripts/generate-openapi.ts) calls setGlobalPrefix + enableVersioning
    // separately from createDocument. Dropping enableVersioning once
    // silently produced a document with every path missing /v1, diverging
    // from what the server actually serves — this doesn't depend on the
    // Swagger CLI plugin (route paths come from Nest's own routing
    // reflection), so it's a real regression guard, not a vacuous one.
    it('documents the actual versioned paths, not the unversioned ones', async () => {
      const res = await request(app.getHttpServer()).get('/api/docs-json').expect(200);

      expect(res.body.paths).toHaveProperty('/api/v1/auth/login');
      expect(res.body.paths).not.toHaveProperty('/api/auth/login');
    });
  });

  describe('production, ENABLE_API_DOCS unset', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createApp({ nodeEnv: 'production' });
    }, 60000);

    afterAll(async () => {
      await app.close();
    });

    it('404s — the route does not exist, rather than merely rejecting', async () => {
      await request(app.getHttpServer()).get('/api/docs').expect(404);
    });
  });

  describe('production, ENABLE_API_DOCS=true', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createApp({
        nodeEnv: 'production',
        enableApiDocs: 'true',
        docsUser: 'docs-admin',
        docsPassword: 'correct-horse-battery-staple',
      });
    }, 60000);

    afterAll(async () => {
      await app.close();
    });

    it('requires authentication — rejects with no credentials', async () => {
      const res = await request(app.getHttpServer()).get('/api/docs').expect(401);
      expect(res.headers['www-authenticate']).toContain('Basic');
    });

    it('requires authentication — rejects wrong credentials', async () => {
      await request(app.getHttpServer()).get('/api/docs').auth('wrong', 'wrong').expect(401);
    });

    it('is reachable with the correct credentials', async () => {
      await request(app.getHttpServer()).get('/api/docs').auth('docs-admin', 'correct-horse-battery-staple').expect(200);
    });

    // Regression guard: app.use('/api/docs', middleware) does not match
    // '/api/docs-json' (Express's mount matching requires a '/' boundary
    // after the prefix) — SwaggerModule.setup's sibling raw-spec route was
    // reachable with zero auth until buildDocsBasicAuthMiddleware started
    // checking req.path itself instead of relying on the mount path.
    it('also requires authentication for the raw JSON spec at /api/docs-json', async () => {
      await request(app.getHttpServer()).get('/api/docs-json').expect(401);
      await request(app.getHttpServer())
        .get('/api/docs-json')
        .auth('docs-admin', 'correct-horse-battery-staple')
        .expect(200);
    });
  });
});
