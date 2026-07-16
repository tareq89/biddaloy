import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { User } from '../modules/users/entities/user.entity';
import { UserRole, UserStatus } from '@beton-boi/shared';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);

  const userRepository = dataSource.getRepository(User);

  // Check if SUPER_ADMIN already exists (including soft-deleted)
  const existing = await userRepository.findOne({
    where: { role: UserRole.SUPER_ADMIN },
    withDeleted: true,
  });

  if (existing) {
    // Restore soft-deleted admin if found, otherwise skip
    if (existing.deleted_at) {
      await userRepository.restore(existing.id);
      console.log('Restored soft-deleted SUPER_ADMIN account.');
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