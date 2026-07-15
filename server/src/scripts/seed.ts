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

  // Check if SUPER_ADMIN already exists
  const existing = await userRepository.findOne({
    where: { role: UserRole.SUPER_ADMIN },
  });

  if (existing) {
    console.log('SUPER_ADMIN user already exists, skipping seed.');
    await app.close();
    return;
  }

  const passwordHash = await bcrypt.hash('admin123', 10);

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
  console.log('  Password: admin123');
  console.log('  Role: SUPER_ADMIN');

  await app.close();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});