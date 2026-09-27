import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffProfile } from './entities/staff-profile.entity';
import { StaffProfilesService } from './staff-profiles.service';

@Module({
  imports: [TypeOrmModule.forFeature([StaffProfile])],
  providers: [StaffProfilesService],
  exports: [StaffProfilesService],
})
export class StaffProfilesModule {}
