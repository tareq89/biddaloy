import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountAccessModule } from '../account-access/account-access.module';
import { AttentionModule } from '../attention/attention.module';
import { AuditModule } from '../audit/audit.module';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { CreditsModule } from '../communications/credits/credits.module';
import { HealthModule } from '../health/health.module';
import { PlatformIdentityModule } from '../platform-identity/platform-identity.module';
import { School } from '../schools/entities/school.entity';
import { SchoolsModule } from '../schools/schools.module';
import { StorageModule } from '../storage/storage.module';
import { PlatformSchoolNote } from '../support-access/entities/platform-school-note.entity';
import { SupportAccessModule } from '../support-access/support-access.module';
import { User } from '../users/entities/user.entity';
import { WorkbookJob } from '../workbook/jobs/workbook-job.entity';
import { ExportModule } from '../workbook/export/export.module';
import { PlatformAnnouncementsController } from './announcements/platform-announcements.controller';
import { PlatformAnnouncementsService } from './announcements/platform-announcements.service';
import { SchoolArchiveController } from './archive/school-archive.controller';
import { SchoolArchiveService } from './archive/school-archive.service';
import { PlatformAuditController } from './audit/platform-audit.controller';
import { PlatformAuditService } from './audit/platform-audit.service';
import { SchoolNotesController } from './notes/school-notes.controller';
import { SchoolNotesService } from './notes/school-notes.service';
import { PlatformOpsQueuesController } from './ops/ops-queues.controller';
import { OpsQueuesService } from './ops/ops-queues.service';
import { PlatformOpsSystemController } from './ops/ops-system.controller';
import { OpsSystemService } from './ops/ops-system.service';
import { SchoolOverviewController } from './overview/school-overview.controller';
import { SchoolOverviewService } from './overview/school-overview.service';
import { PlatformSchoolDeleteController } from './schools/platform-school-delete.controller';
import { PlatformSchoolDeleteService } from './schools/platform-school-delete.service';
import { SchoolHelpController } from './school-help/school-help.controller';
import { SchoolHelpService } from './school-help/school-help.service';
import { SchoolRenameController } from './school-edit/school-rename.controller';
import { SchoolRenameService } from './school-edit/school-rename.service';
import { PlatformUsersController } from './users/platform-users.controller';
import { PlatformUsersService } from './users/platform-users.service';

/**
 * [Epic 99 D28] The one place the Wave 4 cockpit routes are wired. Every controller here is
 * `/platform/**` behind `cockpit-jwt` + `PlatformAdminGuard`. Session cutoff, refresh tokens,
 * `ApprovalGuard`, `BULK_IMPORT_REDIS` and the tenant-status Redis come from @Global modules.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([UserTenant, User, School, PlatformSchoolNote, WorkbookJob]),
    AuditModule,
    PlatformIdentityModule,
    AccountAccessModule,
    SupportAccessModule,
    SchoolsModule,
    HealthModule,
    AttentionModule,
    CreditsModule,
    ExportModule,
    StorageModule,
  ],
  controllers: [
    SchoolHelpController,
    SchoolNotesController,
    PlatformUsersController,
    PlatformAuditController,
    PlatformOpsQueuesController,
    PlatformOpsSystemController,
    PlatformAnnouncementsController,
    PlatformSchoolDeleteController,
    SchoolOverviewController,
    SchoolRenameController,
    SchoolArchiveController,
  ],
  providers: [
    SchoolHelpService,
    SchoolNotesService,
    PlatformUsersService,
    PlatformAuditService,
    OpsQueuesService,
    OpsSystemService,
    PlatformAnnouncementsService,
    PlatformSchoolDeleteService,
    SchoolOverviewService,
    SchoolRenameService,
    SchoolArchiveService,
  ],
})
export class PlatformControlModule {}
