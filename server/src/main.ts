import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";
import { ValidationPipe } from "./common/pipes/validation.pipe";
import * as express from "express";
import { join } from "path";
import { Request, Response, NextFunction } from "express";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Global prefix for API routes
  app.setGlobalPrefix("api");

  // Global filters and pipes
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe());

  // CORS for development (Vite dev server runs on a different port)
  app.enableCors({
    origin: process.env.NODE_ENV === "production" ? false : ["http://localhost:5173"],
    credentials: true,
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

bootstrap();