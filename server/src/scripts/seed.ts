import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { User } from '../modules/users/entities/user.entity';
import { School } from '../modules/schools/entities/school.entity';
import { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import { UserRole, UserStatus } from '@biddaloy/shared';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { ensureRoleTestUsers, ensureSecondSchoolMembership } from './seed.util';

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

  // Check if the designated seed admin already exists (including soft-deleted)
  const existing = await userRepository.findOne({
    where: { email: adminEmail },
    withDeleted: true,
  });

  let admin: User;
  if (existing) {
    if (existing.deleted_at) {
      existing.password_hash = passwordHash;
      existing.status = UserStatus.ACTIVE;
      existing.deleted_at = null;
      await userRepository.save(existing);
      console.log('Restored soft-deleted SUPER_ADMIN account with fresh credentials.');
    } else {
      console.log('SUPER_ADMIN user already exists, skipping creation.');
    }
    admin = existing;
  } else {
    admin = userRepository.create({
      email: adminEmail,
      phone: '01700000000',
      password_hash: passwordHash,
      status: UserStatus.ACTIVE,
      full_name: 'System Administrator',
    });
    await userRepository.save(admin);
    console.log('SUPER_ADMIN user created:');
    console.log(`  Email: ${adminEmail}`);
  }

  // Create the SUPER_ADMIN's membership at the default school, if missing —
  // idempotent the same way the block above is, so a partially-seeded DB
  // (e.g. the admin row survived but its membership was manually deleted)
  // self-heals on the next run instead of erroring.
  const existingMembership = await userTenantRepository.findOne({
    where: { user_id: admin.id, tenant_id: school.id },
  });
  if (!existingMembership) {
    const membership = userTenantRepository.create({
      user_id: admin.id,
      tenant_id: school.id,
      role: UserRole.SUPER_ADMIN,
    });
    await userTenantRepository.save(membership);
    console.log(`  Role: ${membership.role} at ${school.name}`);
  } else if (existingMembership.role !== UserRole.SUPER_ADMIN) {
    existingMembership.role = UserRole.SUPER_ADMIN;
    await userTenantRepository.save(existingMembership);
    console.log(`  Role: reconciled to ${UserRole.SUPER_ADMIN} at ${school.name}`);
  }

  await ensureSecondSchoolMembership(schoolRepository, userTenantRepository, admin.id);

  // [8.9.6]: one account per remaining role, all at the default school —
  // see `seed.util.ts`'s own comment on why this is the manual-testing
  // path for role-gated nav specifically.
  await ensureRoleTestUsers(userRepository, userTenantRepository, school.id, passwordHash);

  await app.close();
}

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
