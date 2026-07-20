import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { UserService, TeacherService } from './users.service';
import { UserController } from './users.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserTenant, Teacher, TeacherClassSection])],
  providers: [UserService, TeacherService],
  controllers: [UserController],
  exports: [UserService, TeacherService],
})
export class UserModule {}