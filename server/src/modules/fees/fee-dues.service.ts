import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { StudentFee } from './entities/student-fee.entity';
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

export interface StudentDueSummary {
  student_id: string;
  full_name: string;
  registration_number: string;
  roll_number: number;
  class_name: string | null;
  section_name: string | null;
  total_due: number;
  months_overdue: number;
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

@Injectable()
export class FeeDuesService {
  constructor(
    @InjectRepository(StudentFee)
    private readonly studentFeeRepo: Repository<StudentFee>,
  ) {}

  async getDues(query: QueryFeeDuesDto, tenantId: string) {
    const statuses = query.status ? [query.status] : OPEN_STATUSES;

    const studentIds = await this.findMatchingStudentIds(tenantId, statuses, {
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

    // Fetch every open fee (any month/year) for the matching students so the
    // response includes previous-month dues, not just the filtered month.
    const dueFees = await this.studentFeeRepo.find({
      where: { student_id: In(studentIds), status: In(OPEN_STATUSES) },
      relations: ['student', 'student.class_section', 'student.class_section.class'],
      order: { year: 'ASC', month: 'ASC' },
    });

    let results = this.groupFeesByStudent(dueFees);

    const sortBy = query.sort_by ?? 'due_amount';
    const sortOrder = query.sort_order ?? (sortBy === 'due_amount' ? 'DESC' : 'ASC');
    results = this.sortSummaries(results, sortBy, sortOrder);

    const total = results.length;
    const start = (page - 1) * limit;
    const data = results.slice(start, start + limit);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getFlaggedDues(query: QueryFlaggedDuesDto, tenantId: string) {
    const today = new Date();

    const studentIds = await this.findMatchingStudentIds(tenantId, OPEN_STATUSES, {
      class_id: query.class_id,
      section_id: query.section_id,
      reminderThresholdBefore: today,
    });

    const page = query.page || 1;
    const limit = query.limit || 10;

    if (studentIds.length === 0) {
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }

    const dueFees = await this.studentFeeRepo.find({
      where: { student_id: In(studentIds), status: In(OPEN_STATUSES) },
      relations: [
        'student',
        'student.class_section',
        'student.class_section.class',
        'student.guardians',
      ],
      order: { year: 'ASC', month: 'ASC' },
    });

    const summaries = this.groupFeesByStudent(dueFees);
    const guardiansByStudent = new Map<string, GuardianContact[]>();
    for (const fee of dueFees) {
      if (!guardiansByStudent.has(fee.student_id)) {
        guardiansByStudent.set(
          fee.student_id,
          (fee.student.guardians ?? []).map((g) => ({
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
    }

    const withGuardians = summaries.map((s) => ({
      ...s,
      guardians: guardiansByStudent.get(s.student_id) ?? [],
    }));

    withGuardians.sort((a, b) => b.months_overdue - a.months_overdue || b.total_due - a.total_due);

    const total = withGuardians.length;
    const start = (page - 1) * limit;
    const data = withGuardians.slice(start, start + limit);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

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

  private groupFeesByStudent(fees: StudentFee[]): StudentDueSummary[] {
    const now = new Date();
    const grouped = new Map<string, StudentDueSummary>();

    for (const fee of fees) {
      const sid = fee.student_id;
      if (!grouped.has(sid)) {
        grouped.set(sid, {
          student_id: sid,
          full_name: fee.student.full_name,
          registration_number: fee.student.registration_number,
          roll_number: fee.student.roll_number,
          class_name: fee.student.class_section?.class?.name ?? null,
          section_name: fee.student.class_section?.section_name ?? null,
          total_due: 0,
          months_overdue: 0,
          dues: [],
        });
      }

      const entry = grouped.get(sid) as StudentDueSummary;
      const balance = Number(fee.total_amount) - Number(fee.paid_amount) - Number(fee.discount_amount);
      entry.total_due += balance;
      if (fee.due_date && new Date(fee.due_date) < now) {
        entry.months_overdue += 1;
      }
      entry.dues.push({
        student_fee_id: fee.id,
        month: fee.month,
        year: fee.year,
        total_amount: fee.total_amount,
        paid_amount: fee.paid_amount,
        discount_amount: fee.discount_amount,
        balance,
        status: fee.status,
        due_date: fee.due_date,
        reminder_threshold_date: fee.reminder_threshold_date,
      });
    }

    return Array.from(grouped.values());
  }

  private sortSummaries(
    summaries: StudentDueSummary[],
    sortBy: 'due_amount' | 'name' | 'class',
    sortOrder: 'ASC' | 'DESC',
  ): StudentDueSummary[] {
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
}
