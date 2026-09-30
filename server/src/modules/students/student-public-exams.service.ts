import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { Student } from './entities/student.entity';
import { StudentPublicExam } from './entities/student-public-exam.entity';
import {
  CreateStudentPublicExamDto,
  UpdateStudentPublicExamDto,
} from './dto/student-public-exams.dto';

const NO_CONTEXT: RequestContext = { ip: null, userAgent: null };

/** [39.2.5] Public-exam history (D21). One live row per (student, exam_type). */
@Injectable()
export class StudentPublicExamsService {
  constructor(
    @InjectRepository(StudentPublicExam) private readonly repo: Repository<StudentPublicExam>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async list(studentId: string, tenantId: string) {
    await this.assertStudent(this.dataSource.manager, studentId, tenantId);
    return this.repo.find({
      where: { student_id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
      order: { passing_year: 'ASC', created_at: 'ASC' },
    });
  }

  async create(
    studentId: string,
    dto: CreateStudentPublicExamDto,
    tenantId: string,
    userId: string,
    context: RequestContext = NO_CONTEXT,
  ) {
    this.assertYear(dto.passing_year);
    return this.dataSource.transaction(async (tx) => {
      // Row lock on the student serializes concurrent creates for the same student,
      // so the duplicate check below cannot race (no unique index backs it — 39.1.2).
      await this.assertStudent(tx, studentId, tenantId, true);
      const repo = tx.getRepository(StudentPublicExam);
      const dup = await repo.findOne({
        where: {
          student_id: studentId,
          tenant_id: tenantId,
          exam_type: dto.exam_type,
          deleted_at: IsNull(),
        },
      });
      if (dup) {
        throw new ConflictException(`A ${dto.exam_type} result already exists for this student`);
      }
      const saved = await repo.save(
        repo.create({
          ...dto,
          gpa: dto.gpa == null ? null : dto.gpa.toFixed(2),
          tenant_id: tenantId,
          student_id: studentId,
        }),
      );
      await this.audit(tx, AuditAction.CREATE, saved, tenantId, userId, context, null, saved);
      return saved;
    });
  }

  async update(
    studentId: string,
    examId: string,
    dto: UpdateStudentPublicExamDto,
    tenantId: string,
    userId: string,
    context: RequestContext = NO_CONTEXT,
  ) {
    if (dto.passing_year !== undefined) this.assertYear(dto.passing_year);
    return this.dataSource.transaction(async (tx) => {
      const row = await this.findRow(tx, studentId, examId, tenantId);
      const before = { ...row };
      const { gpa, ...rest } = dto;
      Object.assign(row, rest);
      if (gpa !== undefined) row.gpa = gpa == null ? null : gpa.toFixed(2); // null clears
      const saved = await tx.getRepository(StudentPublicExam).save(row);
      await this.audit(tx, AuditAction.UPDATE, saved, tenantId, userId, context, before, saved);
      return saved;
    });
  }

  async remove(
    studentId: string,
    examId: string,
    tenantId: string,
    userId: string,
    context: RequestContext = NO_CONTEXT,
  ) {
    await this.dataSource.transaction(async (tx) => {
      const row = await this.findRow(tx, studentId, examId, tenantId);
      await tx.getRepository(StudentPublicExam).softDelete({ id: row.id, tenant_id: tenantId });
      await this.audit(tx, AuditAction.DELETE, row, tenantId, userId, context, row, null);
    });
  }

  private assertYear(year: number) {
    const max = new Date().getFullYear() + 1;
    if (year > max) {
      throw new BadRequestException(`passing_year must not be later than ${max}`);
    }
  }

  private async assertStudent(
    tx: EntityManager,
    studentId: string,
    tenantId: string,
    lock = false,
  ) {
    const student = await tx.getRepository(Student).findOne({
      where: { id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!student) throw new NotFoundException(`Student "${studentId}" not found`);
  }

  private async findRow(tx: EntityManager, studentId: string, examId: string, tenantId: string) {
    const row = await tx.getRepository(StudentPublicExam).findOne({
      where: { id: examId, student_id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!row) throw new NotFoundException(`Public exam "${examId}" not found`);
    return row;
  }

  // AuditEntityType has no 'StudentPublicExam' (shared is outside this ticket's files),
  // so the row is recorded against its Student with exam_id in the values.
  private audit(
    tx: EntityManager,
    action: AuditAction,
    row: StudentPublicExam,
    tenantId: string,
    userId: string,
    context: RequestContext,
    oldRow: StudentPublicExam | null,
    newRow: StudentPublicExam | null,
  ) {
    const pick = (r: StudentPublicExam | null) =>
      r && {
        exam_id: r.id,
        exam_type: r.exam_type,
        board: r.board,
        roll_no: r.roll_no,
        registration_no: r.registration_no,
        gpa: r.gpa,
        passing_year: r.passing_year,
      };
    return this.auditService.record(
      {
        action,
        entity_type: 'Student',
        entity_id: row.student_id,
        tenant_id: tenantId,
        performed_by_user_id: userId,
        ip_address: context.ip,
        user_agent: context.userAgent,
        old_values: pick(oldRow),
        new_values: pick(newRow),
      },
      tx,
    );
  }
}
