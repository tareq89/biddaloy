import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";
import { ValidationPipe } from "./common/pipes/validation.pipe";
import * as express from "express";
import { join } from "path";
import { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { buildCorsOptions } from "./cors-origins";
import { buildHelmetOptions } from "./security-headers";

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

  // Global prefix for API routes
  app.setGlobalPrefix("api");

  // Global filters and pipes
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe());

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