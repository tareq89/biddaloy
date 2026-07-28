import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { StudentFee } from './entities/student-fee.entity';
import { Student } from '../students/entities/student.entity';
import { FeeStatus } from '@beton-boi/shared';
import { QueryFeeDuesDto, QueryFlaggedDuesDto } from './dto/fees.dto';

const OPEN_STATUSES = [FeeStatus.PENDING, FeeStatus.PARTIALLY_PAID];

export interface DueEntry {
  student_fee_id: string;
  month: number;
  year: number;
  total_amount: number;
  paid_amount: number;
  discount_amount: number;
  balance: number;
  status: FeeStatus;
  due_date: Date | null;
  reminder_threshold_date: Date | null;
}

export interface StudentDueAggregate {
  student_id: string;
  full_name: string;
  registration_number: string;
  roll_number: number;
  class_name: string | null;
  section_name: string | null;
  total_due: number;
  months_overdue: number;
}

export interface StudentDueSummary extends StudentDueAggregate {
  dues: DueEntry[];
}

export interface GuardianContact {
  id: string;
  full_name: string;
  relationship: string;
  phone: string | null;
  email: string | null;
  alternate_phone: string | null;
  preferred_communication: string;
  is_primary_contact: boolean;
}

export function sortAggregates(
  summaries: StudentDueAggregate[],
  sortBy: 'due_amount' | 'name' | 'class',
  sortOrder: 'ASC' | 'DESC',
): StudentDueAggregate[] {
  const dir = sortOrder === 'ASC' ? 1 : -1;
  return [...summaries].sort((a, b) => {
    if (sortBy === 'name') {
      return a.full_name.localeCompare(b.full_name) * dir;
    }
    if (sortBy === 'class') {
      return (a.class_name ?? '').localeCompare(b.class_name ?? '') * dir;
    }
    return (a.total_due - b.total_due) * dir;
  });
}

@Injectable()
export class FeeDuesService {
  constructor(
    @InjectRepository(StudentFee)
    private readonly studentFeeRepo: Repository<StudentFee>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  async getDues(query: QueryFeeDuesDto, tenantId: string) {
    // `status` only narrows which students match (e.g. only those with a
    // PARTIALLY_PAID fee); the total_due/dues breakdown below always covers
    // every open (PENDING or PARTIALLY_PAID) fee for a matched student.
    const matchStatuses = query.status ? [query.status] : OPEN_STATUSES;

    const studentIds = await this.findMatchingStudentIds(tenantId, matchStatuses, {
      class_id: query.class_id,
      section_id: query.section_id,
      month: query.month,
      year: query.year,
    });

    const page = query.page || 1;
    const limit = query.limit || 10;

    if (studentIds.length === 0) {
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }

    const aggregates = await this.aggregateForStudents(studentIds);
    const sortBy = query.sort_by ?? 'due_amount';
    const sortOrder = query.sort_order ?? (sortBy === 'due_amount' ? 'DESC' : 'ASC');
    const sorted = sortAggregates(aggregates, sortBy, sortOrder);

    const total = sorted.length;
    const start = (page - 1) * limit;
    const pageAggregates = sorted.slice(start, start + limit);

    const duesByStudent = await this.fetchDuesForStudents(pageAggregates.map((a) => a.student_id));
    const data: StudentDueSummary[] = pageAggregates.map((a) => ({
      ...a,
      dues: duesByStudent.get(a.student_id) ?? [],
    }));

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getFlaggedDues(query: QueryFlaggedDuesDto, tenantId: string) {
    const studentIds = await this.findMatchingStudentIds(tenantId, OPEN_STATUSES, {
      class_id: query.class_id,
      section_id: query.section_id,
      reminderThresholdBefore: new Date(),
    });

    const page = query.page || 1;
    const limit = query.limit || 10;

    if (studentIds.length === 0) {
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }

    const aggregates = await this.aggregateForStudents(studentIds);
    aggregates.sort((a, b) => b.months_overdue - a.months_overdue || b.total_due - a.total_due);

    const total = aggregates.length;
    const start = (page - 1) * limit;
    const pageAggregates = aggregates.slice(start, start + limit);
    const pageStudentIds = pageAggregates.map((a) => a.student_id);

    const [duesByStudent, guardiansByStudent] = await Promise.all([
      this.fetchDuesForStudents(pageStudentIds),
      this.fetchGuardiansForStudents(pageStudentIds),
    ]);

    const data = pageAggregates.map((a) => ({
      ...a,
      dues: duesByStudent.get(a.student_id) ?? [],
      guardians: guardiansByStudent.get(a.student_id) ?? [],
    }));

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Finds the distinct student IDs whose open fees match the given filters.
   * Cheap: selects only student_id, so it's safe to run before pagination
   * even when a tenant has many students with open dues.
   */
  private async findMatchingStudentIds(
    tenantId: string,
    statuses: FeeStatus[],
    filters: {
      class_id?: string;
      section_id?: string;
      month?: number;
      year?: number;
      reminderThresholdBefore?: Date;
    },
  ): Promise<string[]> {
    const qb = this.studentFeeRepo
      .createQueryBuilder('sf')
      .innerJoin('sf.student', 'student')
      .innerJoin('student.class_section', 'cs')
      .innerJoin('cs.class', 'cls')
      .where('student.tenant_id = :tenantId', { tenantId })
      .andWhere('student.deleted_at IS NULL')
      .andWhere('sf.status IN (:...statuses)', { statuses });

    if (filters.class_id) {
      qb.andWhere('cls.id = :classId', { classId: filters.class_id });
    }
    if (filters.section_id) {
      qb.andWhere('cs.id = :sectionId', { sectionId: filters.section_id });
    }
    if (filters.month) {
      qb.andWhere('sf.month = :month', { month: filters.month });
    }
    if (filters.year) {
      qb.andWhere('sf.year = :year', { year: filters.year });
    }
    if (filters.reminderThresholdBefore) {
      qb.andWhere('sf.reminder_threshold_date IS NOT NULL').andWhere(
        'sf.reminder_threshold_date < :threshold',
        { threshold: filters.reminderThresholdBefore },
      );
    }

    qb.select('DISTINCT sf.student_id', 'student_id');
    const rows = await qb.getRawMany<{ student_id: string }>();
    return rows.map((r) => r.student_id);
  }

  /**
   * Computes total_due/months_overdue for a known set of students by
   * aggregating in SQL, so the per-fee rows are never pulled into app memory
   * just to be summed. Sized to the matching-student set, not the page.
   */
  private async aggregateForStudents(studentIds: string[]): Promise<StudentDueAggregate[]> {
    if (studentIds.length === 0) return [];

    const rows = await this.studentFeeRepo
      .createQueryBuilder('sf')
      .innerJoin('sf.student', 'student')
      .leftJoin('student.class_section', 'cs')
      .leftJoin('cs.class', 'cls')
      .select('sf.student_id', 'student_id')
      .addSelect('student.full_name', 'full_name')
      .addSelect('student.registration_number', 'registration_number')
      .addSelect('student.roll_number', 'roll_number')
      .addSelect('cls.name', 'class_name')
      .addSelect('cs.section_name', 'section_name')
      .addSelect('SUM(sf.total_amount - sf.paid_amount - sf.discount_amount)', 'total_due')
      .addSelect('COUNT(*) FILTER (WHERE sf.due_date IS NOT NULL AND sf.due_date < NOW())', 'months_overdue')
      .where('sf.student_id IN (:...studentIds)', { studentIds })
      .andWhere('sf.status IN (:...statuses)', { statuses: OPEN_STATUSES })
      .groupBy('sf.student_id')
      .addGroupBy('student.full_name')
      .addGroupBy('student.registration_number')
      .addGroupBy('student.roll_number')
      .addGroupBy('cls.name')
      .addGroupBy('cs.section_name')
      .getRawMany();

    return rows.map((r) => ({
      student_id: r.student_id,
      full_name: r.full_name,
      registration_number: r.registration_number,
      roll_number: Number(r.roll_number),
      class_name: r.class_name ?? null,
      section_name: r.section_name ?? null,
      total_due: Number(r.total_due),
      months_overdue: Number(r.months_overdue),
    }));
  }

  /**
   * Fetches the full open-fee breakdown (any month/year) for a small set of
   * students — meant to be called only with a single page's worth of IDs.
   */
  private async fetchDuesForStudents(studentIds: string[]): Promise<Map<string, DueEntry[]>> {
    const byStudent = new Map<string, DueEntry[]>();
    if (studentIds.length === 0) return byStudent;

    const fees = await this.studentFeeRepo.find({
      where: { student_id: In(studentIds), status: In(OPEN_STATUSES) },
      order: { year: 'ASC', month: 'ASC' },
    });

    for (const fee of fees) {
      const entries = byStudent.get(fee.student_id) ?? [];
      const totalAmount = Number(fee.total_amount);
      const paidAmount = Number(fee.paid_amount);
      const discountAmount = Number(fee.discount_amount);
      entries.push({
        student_fee_id: fee.id,
        month: fee.month,
        year: fee.year,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        discount_amount: discountAmount,
        balance: totalAmount - paidAmount - discountAmount,
        status: fee.status,
        due_date: fee.due_date,
        reminder_threshold_date: fee.reminder_threshold_date,
      });
      byStudent.set(fee.student_id, entries);
    }

    return byStudent;
  }

  private async fetchGuardiansForStudents(studentIds: string[]): Promise<Map<string, GuardianContact[]>> {
    const byStudent = new Map<string, GuardianContact[]>();
    if (studentIds.length === 0) return byStudent;

    const students = await this.studentRepo.find({
      where: { id: In(studentIds) },
      relations: ['guardians'],
    });

    for (const student of students) {
      byStudent.set(
        student.id,
        (student.guardians ?? []).map((g) => ({
          id: g.id,
          full_name: g.full_name,
          relationship: g.relationship,
          phone: g.phone,
          email: g.email,
          alternate_phone: g.alternate_phone,
          preferred_communication: g.preferred_communication,
          is_primary_contact: g.is_primary_contact,
        })),
      );
    }

    return byStudent;
  }
}
