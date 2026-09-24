import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, QueryFailedError } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as any).code === PG_UNIQUE_VIOLATION;
}
import { Student } from './entities/student.entity';
import { StudentSubjectChoice } from './entities/student-subject-choice.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { SetSubjectChoiceDto } from '../exams/dto/exams.dto';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';

@Injectable()
export class SubjectChoicesService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(ClassSubject)
    private readonly classSubjectRepo: Repository<ClassSubject>,
    @InjectRepository(StudentSubjectChoice)
    private readonly choiceRepo: Repository<StudentSubjectChoice>,
    private readonly auditService: AuditService,
  ) {}

  private async findStudent(studentId: string, tenantId: string): Promise<Student> {
    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }
    return student;
  }

  /** The optional subjects a student may pick from for one academic year
   * (issue rule #6): joins `ClassSubject` on the student's own class
   * (via `class_section`) where `is_optional`, then flags which one, if
   * any, the student has already set as `is_fourth`. */
  async listOptions(
    studentId: string,
    academicYearId: string,
    tenantId: string,
  ): Promise<
    Array<{ class_subject_id: string; subject_id: string; chosen: boolean; is_fourth: boolean }>
  > {
    const student = await this.findStudent(studentId, tenantId);
    const section = await this.sectionRepo.findOne({
      where: { id: student.class_section_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!section) {
      throw new NotFoundException(`Class section for student "${studentId}" not found`);
    }

    const options = await this.classSubjectRepo.find({
      where: {
        class_id: section.class_id,
        academic_year_id: academicYearId,
        is_optional: true,
        tenant_id: tenantId,
        deleted_at: IsNull(),
      },
    });

    const choices = await this.choiceRepo.find({
      where: { student_id: studentId, academic_year_id: academicYearId, tenant_id: tenantId },
    });
    const choiceByClassSubject = new Map(choices.map((c) => [c.class_subject_id, c]));

    return options.map((option) => {
      const choice = choiceByClassSubject.get(option.id);
      return {
        class_subject_id: option.id,
        subject_id: option.subject_id,
        chosen: !!choice,
        is_fourth: choice?.is_fourth ?? false,
      };
    });
  }

  /** Sets (creates or updates) a student's choice for one optional
   * `ClassSubject`. `academic_year_id` on the row is denormalised from the
   * chosen `ClassSubject`, never taken from the caller (see the entity's
   * own docstring). Enforces "one `is_fourth` per student per year"
   * (issue rule #5/Tests) at the service level too, not just the DB's
   * partial unique index — a duplicate here should read as a clear 409,
   * not a raw constraint-violation 500. */
  async setChoice(
    studentId: string,
    dto: SetSubjectChoiceDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<StudentSubjectChoice> {
    const student = await this.findStudent(studentId, tenantId);
    const section = await this.sectionRepo.findOne({
      where: { id: student.class_section_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!section) {
      throw new NotFoundException(`Class section for student "${studentId}" not found`);
    }

    const classSubject = await this.classSubjectRepo.findOne({
      where: {
        id: dto.class_subject_id,
        tenant_id: tenantId,
        is_optional: true,
        deleted_at: IsNull(),
      },
    });
    if (!classSubject) {
      throw new NotFoundException(
        `Optional class-subject offering "${dto.class_subject_id}" not found`,
      );
    }
    // listOptions only ever shows a student offerings from their own
    // class (via section.class_id) — setChoice must reject the same
    // cross-class case rather than silently accepting a choice
    // listOptions would never have shown the caller in the first place.
    if (classSubject.class_id !== section.class_id) {
      throw new NotFoundException(
        `Optional class-subject offering "${dto.class_subject_id}" not found`,
      );
    }

    const isFourth = dto.is_fourth ?? false;

    const existing = await this.choiceRepo.findOne({
      where: { student_id: studentId, class_subject_id: dto.class_subject_id, tenant_id: tenantId },
    });

    // The `existing` lookup above runs outside any lock, so two concurrent
    // PUTs can both pass it and then race on the DB's own unique indexes
    // (IDX_student_subject_choices_one_fourth_per_year, or the
    // student_id+class_subject_id unique index). Whichever loses that
    // race must surface as a clear 409, not a raw 23505-driven 500.
    try {
      return await this.choiceRepo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(StudentSubjectChoice);

        // [pr-fix #945] Replace, not reject: a PUT for a *different*
        // fourth subject than the student's current one used to 409
        // unconditionally, even though this is the panel's normal
        // "change your mind" path (see subject-choices-panel.tsx —
        // selecting a radio button just re-PUTs). Demote the old
        // fourth-subject row to is_fourth:false first, inside this same
        // transaction, before setting the new one — that keeps at most
        // one is_fourth:true row committed at any statement boundary, so
        // the partial unique index never sees two true rows at once.
        if (isFourth) {
          const otherFourth = await repo.findOne({
            where: {
              student_id: studentId,
              academic_year_id: classSubject.academic_year_id,
              is_fourth: true,
              tenant_id: tenantId,
            },
          });
          if (otherFourth && otherFourth.class_subject_id !== dto.class_subject_id) {
            await repo.update({ id: otherFourth.id }, { is_fourth: false });
          }
        }

        let saved: StudentSubjectChoice;
        if (existing) {
          await repo.update({ id: existing.id }, { is_fourth: isFourth });
          saved = { ...existing, is_fourth: isFourth };
        } else {
          const entity = repo.create({
            student_id: studentId,
            class_subject_id: dto.class_subject_id,
            academic_year_id: classSubject.academic_year_id,
            is_fourth: isFourth,
            tenant_id: tenantId,
          });
          saved = await repo.save(entity);
        }

        await this.auditService.record(
          {
            action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
            entity_type: 'StudentSubjectChoice',
            entity_id: saved.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: existing ? { is_fourth: existing.is_fourth } : null,
            new_values: { class_subject_id: saved.class_subject_id, is_fourth: saved.is_fourth },
          },
          manager,
        );

        return saved;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Student already has a fourth subject set for this academic year, or this choice was just changed concurrently.`,
        );
      }
      throw err;
    }
  }
}
