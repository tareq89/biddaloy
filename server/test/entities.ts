/**
 * Re-exports all entity classes for test module registration.
 * This allows tests to register all entities with TypeORM's synchronize.
 */

export { School } from '../src/modules/schools/entities/school.entity';
export { User } from '../src/modules/users/entities/user.entity';
export { UserTenant } from '../src/modules/auth/entities/user-tenant.entity';
export { AcademicYear } from '../src/modules/academics/entities/academic-year.entity';
export { Class } from '../src/modules/academics/entities/class.entity';
export { ClassSection } from '../src/modules/academics/entities/class-section.entity';
export { Student } from '../src/modules/students/entities/student.entity';
export { Guardian } from '../src/modules/students/entities/guardian.entity';
export { Enrollment } from '../src/modules/students/entities/enrollment.entity';
export { Teacher } from '../src/modules/academics/entities/teacher.entity';
export { TeacherClassSection } from '../src/modules/academics/entities/teacher-class-section.entity';
export { FeeStructure } from '../src/modules/fees/entities/fee-structure.entity';
export { FeeStructureStudent } from '../src/modules/fees/entities/fee-structure-student.entity';
export { StudentFee } from '../src/modules/fees/entities/student-fee.entity';
export { Payment } from '../src/modules/fees/entities/payment.entity';
export { PaymentAllocation } from '../src/modules/fees/entities/payment-allocation.entity';
export { Invoice } from '../src/modules/invoices/entities/invoice.entity';
export { CommunicationLog } from '../src/modules/communications/entities/communication-log.entity';
export { ReminderBatch } from '../src/modules/communications/entities/reminder-batch.entity';
export { AuditLog } from '../src/modules/audit/entities/audit-log.entity';

/** All entity classes as an array for TypeORM registration */
export const ALL_ENTITIES = [
  School, User, UserTenant, AcademicYear, Class, ClassSection,
  Student, Guardian, Enrollment, Teacher, TeacherClassSection,
  FeeStructure, FeeStructureStudent, StudentFee, Payment, PaymentAllocation,
  Invoice, CommunicationLog, ReminderBatch, AuditLog,
];