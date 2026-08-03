import { writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';
import { buildSwaggerDocumentConfig } from '../swagger';
import { buildVersioningOptions } from '../api-versioning';

/**
 * Emits the current OpenAPI document as a build artifact (openapi.json, at
 * the server package root) — so the SPAs can generate a typed client from
 * it without needing a running server. Requires a real DATABASE_URL/
 * JWT_SECRET/REDIS_URL, same as any other script in this directory
 * (NestFactory.create boots the full app, including its DB connection).
 *
 * Mirrors main.ts's setGlobalPrefix + enableVersioning exactly — omitting
 * enableVersioning here once already produced a document with every path
 * missing /v1, silently diverging from what the server actually serves.
 */
async function generateOpenApiDocument() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.enableVersioning(buildVersioningOptions());

  const document = SwaggerModule.createDocument(app, buildSwaggerDocumentConfig());
  const outputPath = join(__dirname, '..', '..', 'openapi.json');
  writeFileSync(outputPath, JSON.stringify(document, null, 2));

  // eslint-disable-next-line no-console
  console.log(`Wrote OpenAPI document to ${outputPath}`);

  await app.close();
}

if (require.main === module) {
  generateOpenApiDocument()
    .then(() => process.exit(0))
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Failed to generate OpenAPI document:', error);
      process.exit(1);
    });
}
