import { plainToInstance } from "class-transformer";
import { IsIn, IsNotEmpty, IsOptional, IsString, MinLength, validateSync } from "class-validator";

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