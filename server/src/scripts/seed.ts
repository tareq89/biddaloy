import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { User } from '../modules/users/entities/user.entity';
import { UserRole, UserStatus } from '@beton-boi/shared';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';

export async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);

  const userRepository = dataSource.getRepository(User);

  const adminEmail = 'admin@school.com';

  // Check if the designated seed admin already exists (including soft-deleted)
  const existing = await userRepository.findOne({
    where: { email: adminEmail, role: UserRole.SUPER_ADMIN },
    withDeleted: true,
  });

  if (existing) {
    if (existing.deleted_at) {
      // Restore soft-deleted admin with fresh credentials
      const adminPassword = process.env.SEED_ADMIN_PASSWORD;
      if (!adminPassword || adminPassword.length === 0) {
        console.error(
          'SEED_ADMIN_PASSWORD environment variable is required to restore the seed admin account.'
        );
        process.exit(1);
      }

      const passwordHash = await bcrypt.hash(adminPassword, 10);
      existing.password_hash = passwordHash;
      existing.status = UserStatus.ACTIVE;
      existing.deleted_at = null;

      await userRepository.save(existing);
      console.log('Restored soft-deleted SUPER_ADMIN account with fresh credentials.');
      await app.close();
      return;
    }
    console.log('SUPER_ADMIN user already exists, skipping seed.');
    await app.close();
    return;
  }

  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length === 0) {
    console.error('SEED_ADMIN_PASSWORD environment variable is required but was not set or is empty.');
    process.exit(1);
  }

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

  await app.close();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});