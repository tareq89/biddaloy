import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AuditAction, ExamStatus } from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { ExamSchedule } from './entities/exam-schedule.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditService } from '../audit/audit.service';
import { ResultsService } from './results.service';
import { DocumentPrintDto } from './dto/transcript.dto';

type ReportCard = NonNullable<Awaited<ReturnType<ResultsService['getStudentResultCard']>>>;

export interface Transcript {
  student: {
    id: string;
    full_name: string;
    roll_number: number;
    class_name: string;
    section_name: string | null;
  };
  academic_year: { id: string; name: string };
  exams: ReportCard[];
}

/**
 * [48.2.10] Yearly transcript (one student, every exam of a year) and the
 * audit trail for code-rendered per-student documents (D25/D26). Marks come
 * from `ResultsService.getStudentResultCard`; nothing is recomputed here.
 */
@Injectable()
export class TranscriptService {
  constructor(
    @InjectRepository(Student) private readonly studentRepo: Repository<Student>,
    @InjectRepository(Enrollment) private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(AcademicYear) private readonly yearRepo: Repository<AcademicYear>,
    @InjectRepository(Exam) private readonly examRepo: Repository<Exam>,
    @InjectRepository(ExamSchedule) private readonly scheduleRepo: Repository<ExamSchedule>,
    private readonly resultsService: ResultsService,
    private readonly auditService: AuditService,
  ) {}

  async getTranscript(
    tenantId: string,
    studentId: string,
    yearId: string,
    publishedOnly: boolean,
  ): Promise<Transcript> {
    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    const year = await this.yearRepo.findOne({
      where: { id: yearId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    // Any enrollment status: a student who left still has a valid transcript.
    const enrollment = student
      ? await this.enrollmentRepo.findOne({
          where: { student_id: studentId, academic_year_id: yearId, tenant_id: tenantId },
          relations: { class: true, section: true },
          order: { enrolled_at: 'DESC' },
        })
      : null;
    if (!student || !year || !enrollment) {
      throw new NotFoundException(`No enrollment for student "${studentId}" in that year`);
    }

    const exams = await this.examRepo.find({
      where: {
        tenant_id: tenantId,
        academic_year_id: yearId,
        class_id: enrollment.class_id,
        deleted_at: IsNull(),
        status: publishedOnly
          ? ExamStatus.PUBLISHED
          : In([ExamStatus.PUBLISHED, ExamStatus.PROCESSED]),
      },
    });

    // First sitting date per exam; unscheduled exams sort last.
    const firstSitting = new Map<string, string>();
    if (exams.length) {
      const rows = await this.scheduleRepo
        .createQueryBuilder('s')
        .select('s.exam_id', 'exam_id')
        .addSelect("to_char(MIN(s.date), 'YYYY-MM-DD')", 'first')
        .where('s.tenant_id = :tenantId AND s.exam_id IN (:...ids)', {
          tenantId,
          ids: exams.map((e) => e.id),
        })
        .groupBy('s.exam_id')
        .getRawMany<{ exam_id: string; first: string }>();
      for (const r of rows) firstSitting.set(r.exam_id, r.first);
    }
    const sittingOf = (e: Exam) => firstSitting.get(e.id) ?? '9999-12-31';
    exams.sort(
      (a, b) =>
        sittingOf(a).localeCompare(sittingOf(b)) || a.created_at.getTime() - b.created_at.getTime(),
    );

    const cards: ReportCard[] = [];
    for (const exam of exams) {
      const card = await this.resultsService.getStudentResultCard(
        exam.id,
        studentId,
        tenantId,
        publishedOnly,
      );
      if (card) cards.push(card);
    }

    return {
      student: {
        id: student.id,
        full_name: student.full_name,
        roll_number: student.roll_number,
        class_name: enrollment.class.name,
        section_name: enrollment.section?.section_name ?? null,
      },
      academic_year: { id: year.id, name: year.name },
      exams: cards,
    };
  }

  /** Writes one audit row; 404 (no row) when the target does not exist for this student. */
  async logDocumentPrint(
    tenantId: string,
    userId: string,
    studentId: string,
    dto: DocumentPrintDto,
    publishedOnly: boolean,
  ): Promise<void> {
    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!student) throw new NotFoundException(`Student "${studentId}" not found`);

    let target: Record<string, string>;
    if (dto.document === 'REPORT_CARD') {
      const card = await this.resultsService.getStudentResultCard(
        dto.exam_id!,
        studentId,
        tenantId,
        publishedOnly,
      );
      if (!card) throw new NotFoundException(`No result for student "${studentId}" on that exam`);
      target = { exam_id: dto.exam_id! };
    } else {
      const enrolled = await this.enrollmentRepo.exists({
        where: {
          student_id: studentId,
          academic_year_id: dto.academic_year_id!,
          tenant_id: tenantId,
        },
      });
      if (!enrolled) {
        throw new NotFoundException(`No enrollment for student "${studentId}" in that year`);
      }
      target = { academic_year_id: dto.academic_year_id! };
    }

    await this.auditService.record({
      action: AuditAction.CREATE,
      entity_type: 'StudentDocumentPrint',
      entity_id: studentId,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      new_values: { document: dto.document, ...target },
    });
  }
}
