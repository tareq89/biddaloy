import { DataSource } from 'typeorm';
import { resolve } from 'path';
import { config } from 'dotenv';
import * as bcrypt from 'bcrypt';

// Entities
import { User } from '../modules/users/entities/user.entity';
import { Teacher } from '../modules/academics/entities/teacher.entity';
import { AcademicYear } from '../modules/academics/entities/academic-year.entity';
import { Class } from '../modules/academics/entities/class.entity';
import { ClassSection } from '../modules/academics/entities/class-section.entity';
import { Student } from '../modules/students/entities/student.entity';
import { Guardian } from '../modules/students/entities/guardian.entity';
import { FeeStructure } from '../modules/fees/entities/fee-structure.entity';
import { FeeStructureStudent } from '../modules/fees/entities/fee-structure-student.entity';
import { StudentFee } from '../modules/fees/entities/student-fee.entity';
import { Payment } from '../modules/fees/entities/payment.entity';
import { PaymentAllocation } from '../modules/fees/entities/payment-allocation.entity';
import { Invoice } from '../modules/invoices/entities/invoice.entity';
import { CommunicationLog } from '../modules/communications/entities/communication-log.entity';
import { ReminderBatch } from '../modules/communications/entities/reminder-batch.entity';
import { AuditLog } from '../modules/audit/entities/audit-log.entity';

import { UserRole, UserStatus } from '@beton-boi/shared';

config({ path: resolve(__dirname, '..', '..', '..', '.env') });

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
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
  synchronize: true,
});

async function dbReset() {
  // Safety guard: require explicit confirmation env var
  if (process.env.DB_DESTROY_CONFIRM !== "true") {
    console.error(
      "Destructive operation guard activated.\n" +
      "Set DB_DESTROY_CONFIRM=true to confirm you want to drop ALL tables.\n" +
      "This protects against accidental database destruction in production."
    );
    process.exit(1);
  }

  // Validate seed password before any database work
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length === 0) {
    console.error('SEED_ADMIN_PASSWORD environment variable is required but was not set or is empty.');
    process.exit(1);
  }

  await dataSource.initialize();

  const queryRunner = dataSource.createQueryRunner();

  try {
    // 1. Drop all tables
    await queryRunner.query(`
      DO $$ DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
        LOOP
          EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);

    // 2. Drop all custom ENUM types
    await queryRunner.query(`
      DO $$ DECLARE
        r RECORD;
      BEGIN
        FOR r IN (
          SELECT t.typname
          FROM pg_type t
          JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public'
            AND t.typtype = 'e'
        )
        LOOP
          EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
        END LOOP;
      END $$;
    `);

    // 3. Synchronize schema from entities
    await dataSource.synchronize();
    console.log('Schema created from entities.');

    // 4. Seed admin user
    const userRepository = dataSource.getRepository(User);

    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const admin = userRepository.create({
      email: 'admin@school.com',
      phone: '01700000000',
      password_hash: passwordHash,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      full_name: 'System Administrator',
    });

    await userRepository.save(admin);
    console.log('SUPER_ADMIN user created:');
    console.log('  Email: admin@school.com');
    console.log('  Role: SUPER_ADMIN');
    console.log('');
    console.log('Database reset complete.');
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
}

dbReset().catch((err) => {
  console.error('db:reset failed:', err);
  process.exit(1);
});