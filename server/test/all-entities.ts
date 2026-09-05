import { AcademicYear } from '../src/modules/academics/entities/academic-year.entity';
import { Class } from '../src/modules/academics/entities/class.entity';
import { ClassSection } from '../src/modules/academics/entities/class-section.entity';
import { Teacher } from '../src/modules/academics/entities/teacher.entity';
import { TeacherClassSection } from '../src/modules/academics/entities/teacher-class-section.entity';
import { Subject } from '../src/modules/academics/entities/subject.entity';
import { ClassSubject } from '../src/modules/academics/entities/class-subject.entity';
import { SchoolHoliday } from '../src/modules/academics/entities/school-holiday.entity';
import { AttendanceSession } from '../src/modules/attendance/entities/attendance-session.entity';
import { AttendanceRecord } from '../src/modules/attendance/entities/attendance-record.entity';
import { AttendanceDevice } from '../src/modules/attendance/entities/attendance-device.entity';
import { AttendanceDeviceEvent } from '../src/modules/attendance/entities/attendance-device-event.entity';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { UserTenant } from '../src/modules/auth/entities/user-tenant.entity';
import { AuthToken } from '../src/modules/account-access/entities/auth-token.entity';
import { CommunicationLog } from '../src/modules/communications/entities/communication-log.entity';
import { ReminderBatch } from '../src/modules/communications/entities/reminder-batch.entity';
import { FeeStructure } from '../src/modules/fees/entities/fee-structure.entity';
import { FeeStructureStudent } from '../src/modules/fees/entities/fee-structure-student.entity';
import { Payment } from '../src/modules/fees/entities/payment.entity';
import { PaymentAllocation } from '../src/modules/fees/entities/payment-allocation.entity';
import { StudentFee } from '../src/modules/fees/entities/student-fee.entity';
import { Invoice } from '../src/modules/invoices/entities/invoice.entity';
import { School } from '../src/modules/schools/entities/school.entity';
import { Student } from '../src/modules/students/entities/student.entity';
import { Guardian } from '../src/modules/students/entities/guardian.entity';
import { Enrollment } from '../src/modules/students/entities/enrollment.entity';
import { User } from '../src/modules/users/entities/user.entity';

export const ALL_ENTITIES = [
  AcademicYear,
  Class,
  ClassSection,
  Teacher,
  TeacherClassSection,
  Subject,
  ClassSubject,
  SchoolHoliday,
  AttendanceSession,
  AttendanceRecord,
  AttendanceDevice,
  AttendanceDeviceEvent,
  AuditLog,
  UserTenant,
  AuthToken,
  CommunicationLog,
  ReminderBatch,
  FeeStructure,
  FeeStructureStudent,
  Payment,
  PaymentAllocation,
  StudentFee,
  Invoice,
  School,
  Student,
  Guardian,
  Enrollment,
  User,
];
