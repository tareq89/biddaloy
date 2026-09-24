import { Module, Logger } from '@nestjs/common';
import { resolve } from 'path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { LoggerModule } from 'nestjs-pino';
import { buildPinoOptions } from './common/logging/pino-options';
import { AppController } from './app.controller';
import { resolveDefaultRateLimit } from './rate-limit';
import { buildDatabaseSsl } from './db-ssl';
import { RedactingTypeOrmLogger } from './db-logger';
import { buildRateLimitTracker } from './common/rate-limit/rate-limit-tracker';
import { FailOpenThrottlerStorage } from './common/rate-limit/fail-open-throttler-storage';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AcademicYearModule } from './modules/academics/academic-year.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { ClassModule } from './modules/classes/classes.module';
import { EnrollmentModule } from './modules/enrollments/enrollments.module';
import { UserModule } from './modules/users/users.module';
import { StudentModule } from './modules/students/students.module';
import { FeeModule } from './modules/fees/fees.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { CommunicationsModule } from './modules/communications/communications.module';
import { AuditModule } from './modules/audit/audit.module';
import { SchoolsModule } from './modules/schools/schools.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { RoutinesModule } from './modules/routines/routines.module';
import { AccountAccessModule } from './modules/account-access/account-access.module';
import { WorkbookModule } from './modules/workbook/workbook.module';
import { ExportModule } from './modules/workbook/export/export.module';
import { BackupScheduleModule } from './modules/workbook/schedule/backup-schedule.module';
import { BulkImportModule } from './modules/bulk-import/bulk-import.module';
import { RestoreModule } from './modules/workbook/restore/restore.module';
import { ImportModule } from './modules/workbook/import/import.module';
import { TemplateModule } from './modules/workbook/template/template.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SearchModule } from './modules/search/search.module';
import { GradingModule } from './modules/grading/grading.module';
import { ExamsModule } from './modules/exams/exams.module';
import { validate } from './config/env.validation';

// Entities for auto-loading
import { User } from './modules/users/entities/user.entity';
import { School } from './modules/schools/entities/school.entity';
import { UserTenant } from './modules/auth/entities/user-tenant.entity';
import { Teacher } from './modules/academics/entities/teacher.entity';
import { AcademicYear } from './modules/academics/entities/academic-year.entity';
import { Class } from './modules/academics/entities/class.entity';
import { ClassSection } from './modules/academics/entities/class-section.entity';
import { Student } from './modules/students/entities/student.entity';
import { Guardian } from './modules/students/entities/guardian.entity';
import { FeeStructure } from './modules/fees/entities/fee-structure.entity';
import { DiscountRule } from './modules/fees/entities/discount-rule.entity';
import { StudentFee } from './modules/fees/entities/student-fee.entity';
import { FeeGeneration } from './modules/fees/entities/fee-generation.entity';
import { RecurringSchedule } from './modules/fees/entities/recurring-schedule.entity';
import { RecurringScheduleStructure } from './modules/fees/entities/recurring-schedule-structure.entity';
import { RecurringScheduleExclusion } from './modules/fees/entities/recurring-schedule-exclusion.entity';
import { StudentWallet } from './modules/fees/entities/student-wallet.entity';
import { WalletTransaction } from './modules/fees/entities/wallet-transaction.entity';
import { Payment } from './modules/fees/entities/payment.entity';
import { PaymentAllocation } from './modules/fees/entities/payment-allocation.entity';
import { Invoice } from './modules/invoices/entities/invoice.entity';
import { InvoiceShareToken } from './modules/invoices/entities/invoice-share-token.entity';
import { CommunicationLog } from './modules/communications/entities/communication-log.entity';
import { ReminderBatch } from './modules/communications/entities/reminder-batch.entity';
import { AuditLog } from './modules/audit/entities/audit-log.entity';
import { Enrollment } from './modules/students/entities/enrollment.entity';
import { TeacherClassSection } from './modules/academics/entities/teacher-class-section.entity';
import { Subject } from './modules/academics/entities/subject.entity';
import { ClassSubject } from './modules/academics/entities/class-subject.entity';
import { CalendarEvent } from './modules/calendar/entities/calendar-event.entity';
import { CalendarEventClass } from './modules/calendar/entities/calendar-event-class.entity';
import { AcademicTerm } from './modules/calendar/entities/academic-term.entity';
import { PublicHolidaySet } from './modules/calendar/entities/public-holiday-set.entity';
import { PublicHolidayEntry } from './modules/calendar/entities/public-holiday-entry.entity';
import { CalendarFeedToken } from './modules/calendar/entities/calendar-feed-token.entity';
import { RefreshToken } from './modules/auth/entities/refresh-token.entity';
import { AttendanceSession } from './modules/attendance/entities/attendance-session.entity';
import { AttendanceRecord } from './modules/attendance/entities/attendance-record.entity';
import { AttendanceDevice } from './modules/attendance/entities/attendance-device.entity';
import { AttendanceDeviceEvent } from './modules/attendance/entities/attendance-device-event.entity';
import { Shift } from './modules/routines/entities/shift.entity';
import { PeriodSlot } from './modules/routines/entities/period-slot.entity';
import { Room } from './modules/routines/entities/room.entity';
import { Routine } from './modules/routines/entities/routine.entity';
import { RoutineSlot } from './modules/routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from './modules/routines/entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from './modules/routines/entities/routine-substitution.entity';
import { RoutineChangeRequest } from './modules/routines/entities/routine-change-request.entity';
import { AuthToken } from './modules/account-access/entities/auth-token.entity';
import { WorkbookJob } from './modules/workbook/jobs/workbook-job.entity';
import { GradingScale } from './modules/grading/entities/grading-scale.entity';
import { GradingBand } from './modules/grading/entities/grading-band.entity';
import { Exam } from './modules/exams/entities/exam.entity';
import { ExamComponent } from './modules/exams/entities/exam-component.entity';
import { ExamSchedule } from './modules/exams/entities/exam-schedule.entity';
import { Mark } from './modules/exams/entities/mark.entity';
import { MarkGrid } from './modules/exams/entities/mark-grid.entity';
import { Result } from './modules/exams/entities/result.entity';
import { ResultSubject } from './modules/exams/entities/result-subject.entity';
import { StudentSubjectChoice } from './modules/students/entities/student-subject-choice.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(__dirname, '..', '..', '.env'),
      validate,
    }),
    LoggerModule.forRoot({
      pinoHttp: buildPinoOptions(process.env.NODE_ENV),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const { ssl, warning } = buildDatabaseSsl(
          config.get<string>('NODE_ENV'),
          config.get<string>('DB_SSL'),
          config.get<string>('DB_SSL_REJECT_UNAUTHORIZED'),
        );
        if (warning) {
          new Logger('Bootstrap').warn(warning);
        }

        return {
          type: 'postgres' as const,
          url: config.get<string>('DATABASE_URL'),
          ssl,
          // A pre-built logger instance, not the `logging` boolean below —
          // TypeORM ignores `logging` entirely once `logger` is an object
          // rather than a preset name (see LoggerFactory.create). The
          // instance's own constructor argument is what gates output.
          logger: new RedactingTypeOrmLogger(config.get<string>('NODE_ENV') !== 'production'),
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
            DiscountRule,
            StudentFee,
            FeeGeneration,
            RecurringSchedule,
            RecurringScheduleStructure,
            RecurringScheduleExclusion,
            StudentWallet,
            WalletTransaction,
            Payment,
            PaymentAllocation,
            Invoice,
            InvoiceShareToken,
            CommunicationLog,
            ReminderBatch,
            AuditLog,
            Enrollment,
            TeacherClassSection,
            Subject,
            ClassSubject,
            CalendarEvent,
            CalendarEventClass,
            AcademicTerm,
            PublicHolidaySet,
            PublicHolidayEntry,
            CalendarFeedToken,
            RefreshToken,
            AttendanceSession,
            AttendanceRecord,
            AttendanceDevice,
            AttendanceDeviceEvent,
            AuthToken,
            WorkbookJob,
            GradingScale,
            GradingBand,
            Exam,
            ExamComponent,
            Mark,
            MarkGrid,
            Result,
            ResultSubject,
            ExamSchedule,
            StudentSubjectChoice,
            Shift,
            PeriodSlot,
            Room,
            Routine,
            RoutineSlot,
            RoutineSlotTeacher,
            RoutineSubstitution,
            RoutineChangeRequest,
          ],
          synchronize: config.get<string>('DB_SYNCHRONIZE') === 'true',
          migrations: ['dist/migrations/*.js'],
          migrationsTableName: 'typeorm_migrations',
        };
      },
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379',
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, JwtService],
      useFactory: (config: ConfigService, jwtService: JwtService) => {
        const { limit, ttl } = resolveDefaultRateLimit(
          config.get<string>('RATE_LIMIT_DEFAULT_LIMIT'),
          config.get<string>('RATE_LIMIT_DEFAULT_TTL_MS'),
        );
        return {
          throttlers: [{ name: 'default', limit, ttl }],
          // Distinct connection from BullMQ's: ioredis's default
          // maxRetriesPerRequest (20) queues each command through several
          // seconds of retries before rejecting, which turns "fail open"
          // into "fail slow" — every request hangs for the full retry
          // window during an outage. enableOfflineQueue: false rejects
          // immediately instead, so FailOpenThrottlerStorage can actually
          // fail open without adding latency.
          storage: new FailOpenThrottlerStorage(
            new ThrottlerStorageRedisService(
              config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379',
              {
                enableOfflineQueue: false,
                maxRetriesPerRequest: 1,
              },
            ),
          ),
          getTracker: buildRateLimitTracker(jwtService),
          // The e2e suite fires many requests in sequence against a shared
          // Redis bucket; without this it goes red intermittently on the
          // default tier's limit, not on anything the tests are checking.
          skipIf: () => config.get<string>('NODE_ENV') === 'test',
        };
      },
    }),
    HealthModule,
    AuditModule,
    AuthModule,
    AcademicYearModule,
    CalendarModule,
    ClassModule,
    EnrollmentModule,
    UserModule,
    StudentModule,
    FeeModule,
    InvoicesModule,
    CommunicationsModule,
    SchoolsModule,
    AttendanceModule,
    RoutinesModule,
    AccountAccessModule,
    WorkbookModule,
    ExportModule,
    BackupScheduleModule,
    BulkImportModule,
    ImportModule,
    RestoreModule,
    TemplateModule,
    ReportsModule,
    SearchModule,
    GradingModule,
    ExamsModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
