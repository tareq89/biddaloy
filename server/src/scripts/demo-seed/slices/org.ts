import type { DemoSlice } from '../context';
import { School } from '../../../modules/schools/entities/school.entity';
import { User } from '../../../modules/users/entities/user.entity';
import { UserTenant } from '../../../modules/auth/entities/user-tenant.entity';
import { AcademicYear } from '../../../modules/academics/entities/academic-year.entity';
import { Class } from '../../../modules/academics/entities/class.entity';
import { ClassSection } from '../../../modules/academics/entities/class-section.entity';
import { Subject } from '../../../modules/academics/entities/subject.entity';
import { ClassSubject } from '../../../modules/academics/entities/class-subject.entity';
import { GradingScale } from '../../../modules/grading/entities/grading-scale.entity';
import { GradingBand } from '../../../modules/grading/entities/grading-band.entity';
import { AcademicTerm } from '../../../modules/calendar/entities/academic-term.entity';
import { CalendarEvent } from '../../../modules/calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../../../modules/calendar/entities/calendar-event-class.entity';
import { PublicHolidaySet } from '../../../modules/calendar/entities/public-holiday-set.entity';
import { PublicHolidayEntry } from '../../../modules/calendar/entities/public-holiday-entry.entity';
import { Shift } from '../../../modules/routines/entities/shift.entity';
import { PeriodSlot } from '../../../modules/routines/entities/period-slot.entity';
import { Room } from '../../../modules/routines/entities/room.entity';
import { ExamTemplate } from '../../../modules/exams/entities/exam-template.entity';
import { ExamTemplateComponent } from '../../../modules/exams/entities/exam-template-component.entity';

export const slice: DemoSlice = {
  name: 'org',
  covers: [
    School,
    User,
    UserTenant,
    AcademicYear,
    Class,
    ClassSection,
    Subject,
    ClassSubject,
    GradingScale,
    GradingBand,
    AcademicTerm,
    CalendarEvent,
    CalendarEventClass,
    PublicHolidaySet,
    PublicHolidayEntry,
    Shift,
    PeriodSlot,
    Room,
    ExamTemplate,
    ExamTemplateComponent,
  ],
  owedBy: '58.2.01',
  run: async () => {},
};
