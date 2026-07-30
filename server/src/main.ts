import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";
import { ValidationPipe } from "./common/pipes/validation.pipe";
import * as express from "express";
import { join } from "path";
import { Request, Response, NextFunction } from "express";
import { resolveCorsOrigins } from "./cors-origins";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger("Bootstrap");

  // Global prefix for API routes
  app.setGlobalPrefix("api");

  // Global filters and pipes
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe());

  const corsOrigins = resolveCorsOrigins(process.env.CORS_ORIGINS, process.env.NODE_ENV);
  logger.log(`CORS allowlist: ${corsOrigins.length > 0 ? corsOrigins.join(", ") : "(none)"}`);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // X-Tenant-ID and X-Role are read by ContextGuard on every authenticated
    // request (auth/guards/context.guard.ts) and must survive preflight.
    allowedHeaders: ["Content-Type", "Authorization", "X-Tenant-ID", "X-Role"],
  });

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