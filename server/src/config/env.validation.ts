import { plainToInstance } from "class-transformer";
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MinLength, validateSync } from "class-validator";

const POSITIVE_INTEGER = /^[1-9]\d*$/;

const NODE_ENVS = ["development", "test", "production"] as const;

class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(32)
  JWT_SECRET!: string;

  @IsOptional()
  @IsIn(NODE_ENVS)
  NODE_ENV?: string;

  @IsOptional()
  @IsString()
  PORT?: string;

  // Comma-separated allowlist, e.g. "https://app.example.com,https://admin.example.com".
  // Unset defaults to ['http://localhost:5173'] outside production and [] in
  // production — see resolveCorsOrigins in cors-origins.ts.
  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  // Global rate-limit tier — see rate-limit.ts. Unset defaults to 100
  // requests/60s per tracked identity (authenticated user, else IP).
  // Must be a positive integer string: ThrottlerModule treats a
  // non-numeric, zero, or negative ttl/limit as a startup-time footgun
  // (NaN or a rejecting-everything bucket), so malformed values fail
  // fast here instead of surfacing as unpredictable behavior per request.
  @IsOptional()
  @Matches(POSITIVE_INTEGER, { message: "RATE_LIMIT_DEFAULT_LIMIT must be a positive integer" })
  RATE_LIMIT_DEFAULT_LIMIT?: string;

  @IsOptional()
  @Matches(POSITIVE_INTEGER, { message: "RATE_LIMIT_DEFAULT_TTL_MS must be a positive integer" })
  RATE_LIMIT_DEFAULT_TTL_MS?: string;

  // Login lockout policy — see login-attempt.service.ts. Unset defaults to
  // 5 failed attempts / 15 minutes.
  @IsOptional()
  @Matches(POSITIVE_INTEGER, { message: "LOGIN_LOCKOUT_THRESHOLD must be a positive integer" })
  LOGIN_LOCKOUT_THRESHOLD?: string;

  @IsOptional()
  @Matches(POSITIVE_INTEGER, { message: "LOGIN_LOCKOUT_WINDOW_MS must be a positive integer" })
  LOGIN_LOCKOUT_WINDOW_MS?: string;

  // Swagger docs gate — see swagger.ts/docs-auth.ts. Docs always mount
  // outside production; in production only when this is exactly "true",
  // and then only behind API_DOCS_USER/API_DOCS_PASSWORD Basic Auth.
  @IsOptional()
  @IsString()
  ENABLE_API_DOCS?: string;

  @IsOptional()
  @IsString()
  API_DOCS_USER?: string;

  @IsOptional()
  @IsString()
  API_DOCS_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SMS_PROVIDER?: string;

  @IsOptional()
  @IsString()
  GREENWEB_API_KEY?: string;

  @IsOptional()
  @IsString()
  MIMSMS_API_KEY?: string;

  @IsOptional()
  @IsString()
  MIMSMS_SENDER_ID?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_ACCESS_TOKEN?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_PHONE_NUMBER_ID?: string;

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsString()
  SMTP_PORT?: string;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SMTP_FROM?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedConfig;
}