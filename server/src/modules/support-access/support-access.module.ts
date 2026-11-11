import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImpersonationSession } from './entities/impersonation-session.entity';
import { PlatformSchoolNote } from './entities/platform-school-note.entity';
import { PlatformAnnouncement } from './entities/platform-announcement.entity';

/** Shell only (D28): Wave 2 adds providers and controllers. */
@Module({
  imports: [
    TypeOrmModule.forFeature([ImpersonationSession, PlatformSchoolNote, PlatformAnnouncement]),
  ],
})
export class SupportAccessModule {}
