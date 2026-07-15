import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppController } from "./app.controller";
import { HealthModule } from "./modules/health/health.module";
import { validate } from "./config/env.validation";

// Entities for auto-loading
import { User } from "./modules/users/entities/user.entity";
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === "production" ? "../.env" : ".env",
      validate,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres",
        url: config.get<string>("DATABASE_URL"),
        entities: [
          User,
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
        ],
        synchronize: config.get<string>("NODE_ENV") !== "production",
        logging: config.get<string>("NODE_ENV") !== "production",
        migrations: ["dist/migrations/*.js"],
        migrationsTableName: "typeorm_migrations",
      }),
    }),
    HealthModule,
  ],
  controllers: [AppController],
})
export class AppModule {}