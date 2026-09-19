import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarEventClass } from './entities/calendar-event-class.entity';
import { AcademicTerm } from './entities/academic-term.entity';
import { PublicHolidaySet } from './entities/public-holiday-set.entity';
import { PublicHolidayEntry } from './entities/public-holiday-entry.entity';
import { CalendarFeedToken } from './entities/calendar-feed-token.entity';
import { AttendanceSession } from '../attendance/entities/attendance-session.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { ReminderBatch } from '../communications/entities/reminder-batch.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { CreditsModule } from '../communications/credits/credits.module';
import { SchoolsModule } from '../schools/schools.module';
import { AuditModule } from '../audit/audit.module';
import { PushModule } from '../push/push.module';
import { BulkImportModule } from '../bulk-import/bulk-import.module';
import { StudentModule } from '../students/students.module';
import { SchoolCalendarService } from './school-calendar.service';
import { SchoolCalendarController } from './school-calendar.controller';
import { CalendarEventsService } from './calendar-events.service';
import { CalendarEventsController } from './calendar-events.controller';
import { AcademicTermsService } from './academic-terms.service';
import { AcademicTermsController } from './academic-terms.controller';
import { CalendarSettingsController } from './calendar-settings.controller';
import { PublicHolidaysService } from './public-holidays.service';
import { PublicHolidaysController } from './public-holidays.controller';
import { PublicHolidayFetchService } from './public-holiday-fetch.service';
import { CalendarImportService } from './calendar-import.service';
import { CalendarImportController } from './calendar-import.controller';
import { CalendarExportService } from './calendar-export.service';
import { CalendarExportController } from './calendar-export.controller';
import { CalendarNotifyService } from './calendar-notify.service';
import { CalendarFeedService } from './calendar-feed.service';
import { CalendarFeedController } from './calendar-feed.controller';

/**
 * The academic-calendar module (Epic 17). [17.1.2] creates this module as
 * a skeleton with every entity registered and every controller/service
 * stubbed in, so every later wave-2/3/4 task in this epic only fills in a
 * file that already exists here — none of them touch this file again.
 *
 * `SchoolHoliday`/`school_holidays` moved here from `AcademicYearModule` as
 * `CalendarEvent`/`calendar_events` — see `calendar-event.entity.ts` and
 * the `1789600000000-AcademicCalendar` migration for the rename.
 *
 * Entity-only registrations (`AttendanceSession`, `Class`, `ClassSection`,
 * `Student`, `TeacherClassSection`, `AcademicYear`) let this module's
 * services query against them without a cross-module DI cycle, same
 * reasoning as `attendance.module.ts`'s own comment.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CalendarEvent,
      CalendarEventClass,
      AcademicTerm,
      PublicHolidaySet,
      PublicHolidayEntry,
      CalendarFeedToken,
      AttendanceSession,
      Class,
      ClassSection,
      Student,
      TeacherClassSection,
      AcademicYear,
      UserTenant,
      ReminderBatch,
      CommunicationLog,
    ]),
    // [17.3.3] SMS reuses the same COMMUNICATIONS_QUEUE primitive
    // `attendance.module.ts`'s AbsenceNoticeService uses, rather than
    // importing the whole CommunicationsModule provider graph.
    BullModule.registerQueue({ name: COMMUNICATIONS_QUEUE }),
    // [#713] Real `SmsCreditService.reserve`/`settle` (via `CreditsModule`)
    // instead of a raw `sms_credit_balance` UPDATE — now that both bare
    // `CreditsModule` imports on its own cycle (`invoices.module.ts`,
    // `communications.module.ts`) are `forwardRef`'d, this import no
    // longer trips the circular-init bug that motivated the workaround.
    CreditsModule,
    SchoolsModule,
    AuditModule,
    PushModule,
    BulkImportModule,
    StudentModule,
  ],
  providers: [
    SchoolCalendarService,
    CalendarEventsService,
    AcademicTermsService,
    PublicHolidaysService,
    PublicHolidayFetchService,
    CalendarImportService,
    CalendarExportService,
    CalendarNotifyService,
    CalendarFeedService,
  ],
  controllers: [
    SchoolCalendarController,
    CalendarEventsController,
    AcademicTermsController,
    CalendarSettingsController,
    PublicHolidaysController,
    CalendarImportController,
    CalendarExportController,
    CalendarFeedController,
  ],
  // SchoolCalendarService is exported for AttendanceModule's working-day
  // math (summary service) and for AttendanceService's non-working-day
  // check on the write path.
  exports: [SchoolCalendarService],
})
export class CalendarModule {}
