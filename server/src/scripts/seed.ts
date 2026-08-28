import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import * as bcrypt from 'bcrypt';
import { User } from '../modules/users/entities/user.entity';
import { School } from '../modules/schools/entities/school.entity';
import { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import { AcademicYear } from '../modules/academics/entities/academic-year.entity';
import { Class } from '../modules/academics/entities/class.entity';
import { ClassSection } from '../modules/academics/entities/class-section.entity';
import { Student } from '../modules/students/entities/student.entity';
import { Guardian } from '../modules/students/entities/guardian.entity';
import { seedAccounts } from './seed.accounts';

export { seedAccounts, type SeedAccountRepositories } from './seed.accounts';

export async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);

  const userRepository = dataSource.getRepository(User);
  const schoolRepository = dataSource.getRepository(School);
  const userTenantRepository = dataSource.getRepository(UserTenant);

  const adminEmail = 'admin@school.com';

  // Required unconditionally now, not just when creating/restoring the
  // SUPER_ADMIN — `ensureRoleTestUsers` below needs it too, on every run:
  // a re-run against an already-seeded dev DB may still be the first run
  // to add the six [8.9.6] role-test accounts.
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length === 0) {
    console.error(
      'SEED_ADMIN_PASSWORD environment variable is required but was not set or is empty.',
    );
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  // Ensure the default school exists — every account below is a member of it.
  let school = await schoolRepository.findOne({ where: { slug: 'default-school' } });
  if (!school) {
    school = schoolRepository.create({ name: 'Default School', slug: 'default-school' });
    await schoolRepository.save(school);
    console.log(`Created default school (${school.id}).`);
  }

  await seedAccounts(
    {
      userRepository,
      schoolRepository,
      userTenantRepository,
      academicYearRepository: dataSource.getRepository(AcademicYear),
      classRepository: dataSource.getRepository(Class),
      classSectionRepository: dataSource.getRepository(ClassSection),
      studentRepository: dataSource.getRepository(Student),
      guardianRepository: dataSource.getRepository(Guardian),
    },
    school,
    adminEmail,
    passwordHash,
  );

  await app.close();
}

// Only self-execute when run as a script (`yarn seed`). `seed.spec.ts`
// imports `seedAccounts` from this file, and an unguarded call here would
// try to boot the whole AppModule — and then `process.exit` — during the
// test run.
const isDirectRun =
  typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;

if (isDirectRun) {
  seed()
    // NestFactory.createApplicationContext boots the full AppModule, including
    // AuthModule/CommunicationsModule's BullMQ workers (@Processor). Those hold
    // open blocking Redis connections that app.close() doesn't reliably tear
    // down, so the process can hang indefinitely after seeding finishes —
    // force-exit once the promise settles instead of waiting on the event loop.
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
