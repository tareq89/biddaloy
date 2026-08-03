import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";
import * as express from "express";
import { join } from "path";
import { Request, Response, NextFunction } from "express";
import cookieParser = require("cookie-parser");
import helmet from "helmet";
import { buildCorsOptions } from "./cors-origins";
import { buildHelmetOptions } from "./security-headers";
import { buildValidationPipeOptions } from "./validation-pipe";
import { buildVersioningOptions } from "./api-versioning";
import { buildSwaggerDocumentConfig, shouldMountDocs, DOCS_PATH } from "./swagger";
import { buildDocsBasicAuthMiddleware, buildDocsCspOverrideMiddleware } from "./docs-auth";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger("Bootstrap");

  // Trust exactly one hop (the nginx container in front of this app — see
  // docker-compose.yml) so req.ip/req.protocol reflect the real client
  // rather than nginx's own address and the internal http:// connection.
  // A higher number, or `true`, would let a client spoof X-Forwarded-For by
  // sending its own and having it treated as trusted.
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  // As early as possible, and before the static-serving middleware below —
  // security headers should apply to every response, including the SPAs.
  app.use(helmet(buildHelmetOptions(process.env.NODE_ENV)));
  // Swagger UI needs inline script/style the global CSP above deliberately
  // doesn't allow anywhere else — see docs-auth.ts.
  app.use(buildDocsCspOverrideMiddleware(`/api/${DOCS_PATH}`));
  // Needed to read the httpOnly refresh token cookie on /auth/refresh,
  // /auth/logout, /auth/logout-all — see token-cookie.ts.
  app.use(cookieParser());

  // Global prefix for API routes
  app.setGlobalPrefix("api");
  // Every route gets /v1 unless marked @Version(VERSION_NEUTRAL) (health) —
  // see api-versioning.ts.
  app.enableVersioning(buildVersioningOptions());

  // Global filters and pipes
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));

  // API docs — always on outside production; in production only when
  // explicitly opted into, and then only behind Basic Auth. Never mounted
  // in production otherwise, so the route is a genuine 404, not just a
  // rejection. See swagger.ts for the full policy.
  if (shouldMountDocs(process.env.NODE_ENV, process.env.ENABLE_API_DOCS)) {
    if (process.env.NODE_ENV === "production") {
      const docsUser = process.env.API_DOCS_USER;
      const docsPassword = process.env.API_DOCS_PASSWORD;
      if (!docsUser || !docsPassword) {
        throw new Error(
          "ENABLE_API_DOCS=true requires API_DOCS_USER and API_DOCS_PASSWORD to be set — refusing to boot with an unauthenticated docs route in production.",
        );
      }
      // No path argument here — buildDocsBasicAuthMiddleware checks
      // req.path itself, because app.use('/api/docs', ...) would not
      // match the sibling /api/docs-json route SwaggerModule.setup also
      // registers (Express's mount matching requires a '/' boundary after
      // the prefix), which would otherwise serve the raw spec unauthenticated.
      app.use(buildDocsBasicAuthMiddleware(`/api/${DOCS_PATH}`, docsUser, docsPassword));
    }

    const document = SwaggerModule.createDocument(app, buildSwaggerDocumentConfig());
    SwaggerModule.setup(DOCS_PATH, app, document, { useGlobalPrefix: true });
  }

  const corsOptions = buildCorsOptions(process.env.CORS_ORIGINS, process.env.NODE_ENV);
  const origins = corsOptions.origin as string[];
  logger.log(`CORS allowlist: ${origins.length > 0 ? origins.join(", ") : "(none)"}`);

  app.enableCors(corsOptions);

  // In production, serve client static builds
  if (process.env.NODE_ENV === "production") {
    const clients = ["student", "teacher", "admin"];

    for (const client of clients) {
      const distPath = join(__dirname, "..", "..", `client-${client}`);

      // Serve static assets
      app.use(`/${client}`, express.static(distPath));

      // SPA fallback: any unknown route under /client/ serves index.html
      app.use(`/${client}`, (_req: Request, res: Response) => {
        res.sendFile(join(distPath, "index.html"));
      });
    }

    // Root redirect to /student/ (only for non-API, non-client paths)
    app.use("/", (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api/") || req.path === "/api") {
        return next();
      }
      res.redirect("/student/");
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}

// Guarded so importing resolveCorsOrigins for tests doesn't also boot a
// real Nest application.
if (require.main === module) {
  bootstrap();
}