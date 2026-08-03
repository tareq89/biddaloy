import { Module, Logger } from "@nestjs/common";
import { resolve } from "path";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bullmq";
import { APP_GUARD } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { AppController } from "./app.controller";
import { resolveDefaultRateLimit } from "./rate-limit";
import { buildDatabaseSsl } from "./db-ssl";
import { RedactingTypeOrmLogger } from "./db-logger";
import { buildRateLimitTracker } from "./common/rate-limit/rate-limit-tracker";
import { FailOpenThrottlerStorage } from "./common/rate-limit/fail-open-throttler-storage";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AcademicYearModule } from "./modules/academics/academic-year.module";
import { ClassModule } from "./modules/classes/classes.module";
import { EnrollmentModule } from "./modules/enrollments/enrollments.module";
import { UserModule } from "./modules/users/users.module";
import { StudentModule } from "./modules/students/students.module";
import { FeeModule } from "./modules/fees/fees.module";
import { InvoicesModule } from "./modules/invoices/invoices.module";
import { CommunicationsModule } from "./modules/communications/communications.module";
import { AuditModule } from "./modules/audit/audit.module";
import { validate } from "./config/env.validation";

// Entities for auto-loading
import { User } from "./modules/users/entities/user.entity";
import { School } from "./modules/schools/entities/school.entity";
import { UserTenant } from "./modules/auth/entities/user-tenant.entity";
import { Teacher } from "./modules/academics/entities/teacher.entity";
import { AcademicYear } from "./modules/academics/entities/academic-year.entity";
import { Class } from "./modules/academics/entities/class.entity";
import { ClassSection } from "./modules/academics/entities/class-section.entity";
import { Student } from "./modules/students/entities/student.entity";
import { Guardian } from "./modules/students/entities/guardian.entity";
import { FeeStructure } from "./modules/fees/entities/fee-structure.entity";
import { FeeStructureStudent } from "./modules/fees/entities/fee-structure-student.entity";
import { StudentFee } from "./modules/fees/entities/student-fee.entity";
import { Payment } from "./modules/fees/entities/payment.entity";
import { PaymentAllocation } from "./modules/fees/entities/payment-allocation.entity";
import { Invoice } from "./modules/invoices/entities/invoice.entity";
import { CommunicationLog } from "./modules/communications/entities/communication-log.entity";
import { ReminderBatch } from "./modules/communications/entities/reminder-batch.entity";
import { AuditLog } from "./modules/audit/entities/audit-log.entity";
import { Enrollment } from "./modules/students/entities/enrollment.entity";
import { TeacherClassSection } from "./modules/academics/entities/teacher-class-section.entity";
import { RefreshToken } from "./modules/auth/entities/refresh-token.entity";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(__dirname, '..', '..', '.env'),
      validate,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const { ssl, warning } = buildDatabaseSsl(
          config.get<string>("NODE_ENV"),
          config.get<string>("DB_SSL"),
          config.get<string>("DB_SSL_REJECT_UNAUTHORIZED"),
        );
        if (warning) {
          new Logger("Bootstrap").warn(warning);
        }

        return {
          type: "postgres" as const,
          url: config.get<string>("DATABASE_URL"),
          ssl,
          // A pre-built logger instance, not the `logging` boolean below —
          // TypeORM ignores `logging` entirely once `logger` is an object
          // rather than a preset name (see LoggerFactory.create). The
          // instance's own constructor argument is what gates output.
          logger: new RedactingTypeOrmLogger(config.get<string>("NODE_ENV") !== "production"),
          entities: [
            User,
            School,
            UserTenant,
            Teacher,
            AcademicYear,
            Class,
            ClassSection,
            Student,
            Guardian,
            FeeStructure,
            FeeStructureStudent,
            StudentFee,
            Payment,
            PaymentAllocation,
            Invoice,
            CommunicationLog,
            ReminderBatch,
            AuditLog,
            Enrollment,
            TeacherClassSection,
            RefreshToken,
          ],
          synchronize: config.get<string>("DB_SYNCHRONIZE") === "true",
          migrations: ["dist/migrations/*.js"],
          migrationsTableName: "typeorm_migrations",
        };
      },
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>("REDIS_URL") ?? "redis://localhost:6379",
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, JwtService],
      useFactory: (config: ConfigService, jwtService: JwtService) => {
        const { limit, ttl } = resolveDefaultRateLimit(
          config.get<string>("RATE_LIMIT_DEFAULT_LIMIT"),
          config.get<string>("RATE_LIMIT_DEFAULT_TTL_MS"),
        );
        return {
          throttlers: [{ name: "default", limit, ttl }],
          // Distinct connection from BullMQ's: ioredis's default
          // maxRetriesPerRequest (20) queues each command through several
          // seconds of retries before rejecting, which turns "fail open"
          // into "fail slow" — every request hangs for the full retry
          // window during an outage. enableOfflineQueue: false rejects
          // immediately instead, so FailOpenThrottlerStorage can actually
          // fail open without adding latency.
          storage: new FailOpenThrottlerStorage(
            new ThrottlerStorageRedisService(config.get<string>("REDIS_URL") ?? "redis://localhost:6379", {
              enableOfflineQueue: false,
              maxRetriesPerRequest: 1,
            }),
          ),
          getTracker: buildRateLimitTracker(jwtService),
          // The e2e suite fires many requests in sequence against a shared
          // Redis bucket; without this it goes red intermittently on the
          // default tier's limit, not on anything the tests are checking.
          skipIf: () => config.get<string>("NODE_ENV") === "test",
        };
      },
    }),
    HealthModule,
    AuditModule,
    AuthModule,
    AcademicYearModule,
    ClassModule,
    EnrollmentModule,
    UserModule,
    StudentModule,
    FeeModule,
    InvoicesModule,
    CommunicationsModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}