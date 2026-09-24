import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HomeworkGradingMode, HomeworkSubmissionStatus } from '@biddaloy/shared';
import { Homework } from './entities/homework.entity';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkSubmission } from './entities/homework-submission.entity';
import { HomeworkAccessService } from './homework-access.service';
import { Student } from '../students/entities/student.entity';
import { FamilyAccessService } from '../students/family-access.service';
import { StorageService } from '../storage/storage.service';
import { tenantObjectKey } from '../storage/storage-key';
import { UpdateHomeworkSubmissionDto } from './dto/homework-submission.dto';

interface CallerContext {
  role: string;
  userId: string;
  tenantId: string;
}

/** D27 — file cap shared by teacher-attachment and student-submission
 * uploads. Only this side (submissions) is implemented here. */
export const HOMEWORK_SUBMISSION_MAX_FILES = 10;
export const HOMEWORK_SUBMISSION_MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

interface SubmissionAttachment {
  key: string;
  filename: string;
  mimetype: string;
  size: number;
}

/**
 * [22.3.2] Student/guardian submission upload + teacher grade/override.
 *
 * `FamilyAccessService.assertLinked` is the single "does this caller own
 * this student" check (D26) — the same one `GET /students/mine` and the
 * attendance-summary routes use, so a PARENT/STUDENT can never submit for a
 * child they aren't linked to, and the check is tenant-scoped by
 * construction.
 */
@Injectable()
export class HomeworkSubmissionService {
  constructor(
    @InjectRepository(Homework)
    private readonly homeworkRepo: Repository<Homework>,
    @InjectRepository(HomeworkAssignment)
    private readonly assignmentRepo: Repository<HomeworkAssignment>,
    @InjectRepository(HomeworkSubmission)
    private readonly submissionRepo: Repository<HomeworkSubmission>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    private readonly access: HomeworkAccessService,
    private readonly familyAccess: FamilyAccessService,
    private readonly storage: StorageService,
  ) {}

  private async loadAssignment(
    assignmentId: string,
    tenantId: string,
  ): Promise<HomeworkAssignment> {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId, tenant_id: tenantId },
    });
    if (!assignment) {
      throw new NotFoundException('Homework assignment not found');
    }
    return assignment;
  }

  /** Validates that `studentId` is actually within the scope this
   * assignment targets — a single-student assignment must match exactly, a
   * section assignment must contain the student. Otherwise a linked
   * guardian could submit against an assignment that was never sent to
   * their child. */
  private async assertStudentInScope(
    assignment: HomeworkAssignment,
    studentId: string,
  ): Promise<void> {
    if (assignment.student_id) {
      if (assignment.student_id !== studentId) {
        throw new ForbiddenException('This assignment was not sent to this student');
      }
      return;
    }

    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: assignment.tenant_id },
    });
    if (!student || student.class_section_id !== assignment.section_id) {
      throw new ForbiddenException('This assignment was not sent to this student');
    }
  }

  private validateFiles(files: Express.Multer.File[]): void {
    if (files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }
    if (files.length > HOMEWORK_SUBMISSION_MAX_FILES) {
      throw new BadRequestException(`At most ${HOMEWORK_SUBMISSION_MAX_FILES} files are allowed`);
    }
    for (const file of files) {
      if (file.size > HOMEWORK_SUBMISSION_MAX_FILE_SIZE) {
        throw new BadRequestException(
          `Each file must be at most ${HOMEWORK_SUBMISSION_MAX_FILE_SIZE / (1024 * 1024)}MB`,
        );
      }
      if (!ALLOWED_MIME_TO_EXT[file.mimetype]) {
        throw new BadRequestException('Files must be PDF, JPG, PNG or WebP');
      }
    }
  }

  /**
   * `POST /homework-assignments/:id/submissions`. Same route handles the
   * first upload and every resubmission — resubmission replaces the whole
   * `attachments` array, both gated on `now() <= due_date`.
   */
  async upload(
    assignmentId: string,
    studentId: string,
    files: Express.Multer.File[],
    ctx: CallerContext,
  ): Promise<HomeworkSubmission> {
    const assignment = await this.loadAssignment(assignmentId, ctx.tenantId);

    await this.familyAccess.assertLinked(ctx.role, ctx.userId, studentId, ctx.tenantId);
    await this.assertStudentInScope(assignment, studentId);

    // due_date is a DATE column (no time-of-day) — end-of-day in the
    // server's local representation, same convention as
    // HomeworkAssignmentStatus checks elsewhere in this module.
    const dueDateEnd = new Date(`${assignment.due_date}T23:59:59.999`);
    if (new Date() > dueDateEnd) {
      throw new BadRequestException('The due date for this assignment has passed');
    }

    this.validateFiles(files);

    const attachments: SubmissionAttachment[] = [];
    for (const file of files) {
      const ext = ALLOWED_MIME_TO_EXT[file.mimetype];
      const key = tenantObjectKey(ctx.tenantId, 'homework-submissions', ext);
      await this.storage.put(key, file.buffer, file.mimetype);
      attachments.push({
        key,
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      });
    }

    // ponytail: read-then-create has a race window under concurrent uploads
    // for the same (assignment_id, student_id) — the DB's UNIQUE index
    // (IDX_homework_submissions_assignment_student) stops it from ever
    // creating two rows, so the failure mode is a 500 on the loser's insert,
    // not silent duplication. Upgrade to a real upsert if concurrent
    // resubmission from two devices turns out to be common.
    let submission = await this.submissionRepo.findOne({
      where: { assignment_id: assignmentId, student_id: studentId, tenant_id: ctx.tenantId },
    });
    if (!submission) {
      submission = this.submissionRepo.create({
        assignment_id: assignmentId,
        student_id: studentId,
        tenant_id: ctx.tenantId,
        status: HomeworkSubmissionStatus.NOT_SUBMITTED,
      });
    }

    submission.attachments = attachments;
    // D9: teacher override (PARTIAL/DONE) always wins — an upload never
    // resets a status the teacher already set. A brand-new row (or one
    // still NOT_SUBMITTED) flips to SUBMITTED; PARTIAL/DONE stay put.
    if (
      submission.status !== HomeworkSubmissionStatus.PARTIAL &&
      submission.status !== HomeworkSubmissionStatus.DONE
    ) {
      submission.status = HomeworkSubmissionStatus.SUBMITTED;
    }

    return this.submissionRepo.save(submission);
  }

  /** `PATCH /homework-submissions/:id` — teacher grade/override. */
  async update(
    submissionId: string,
    dto: UpdateHomeworkSubmissionDto,
    ctx: CallerContext,
  ): Promise<HomeworkSubmission> {
    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId, tenant_id: ctx.tenantId },
    });
    if (!submission) {
      throw new NotFoundException('Homework submission not found');
    }
    const assignment = await this.loadAssignment(submission.assignment_id, ctx.tenantId);
    const homework = await this.homeworkRepo.findOne({
      where: { id: assignment.homework_id, tenant_id: ctx.tenantId },
    });
    if (!homework) {
      throw new NotFoundException('Homework not found');
    }

    if (assignment.section_id) {
      await this.access.assertCanManageSection(
        ctx.role,
        ctx.userId,
        assignment.section_id,
        homework.subject_id,
        ctx.tenantId,
      );
    } else {
      await this.access.assertCanManageStudent(
        ctx.role,
        ctx.userId,
        assignment.student_id as string,
        homework.subject_id,
        ctx.tenantId,
      );
    }

    if (dto.marks !== undefined && homework.grading_mode !== HomeworkGradingMode.MARKS) {
      throw new BadRequestException(
        'Marks can only be set when the homework grading mode is MARKS',
      );
    }

    if (dto.status !== undefined) {
      submission.status = dto.status;
    }
    if (dto.marks !== undefined) {
      submission.marks = dto.marks;
    }

    return this.submissionRepo.save(submission);
  }

  /** `GET /homework-assignments/:id/submissions` — teacher grid view. */
  async findAllForAssignment(
    assignmentId: string,
    ctx: CallerContext,
  ): Promise<HomeworkSubmission[]> {
    const assignment = await this.loadAssignment(assignmentId, ctx.tenantId);
    const homework = await this.homeworkRepo.findOne({
      where: { id: assignment.homework_id, tenant_id: ctx.tenantId },
    });
    if (!homework) {
      throw new NotFoundException('Homework not found');
    }

    if (assignment.section_id) {
      await this.access.assertCanManageSection(
        ctx.role,
        ctx.userId,
        assignment.section_id,
        homework.subject_id,
        ctx.tenantId,
      );
    } else {
      await this.access.assertCanManageStudent(
        ctx.role,
        ctx.userId,
        assignment.student_id as string,
        homework.subject_id,
        ctx.tenantId,
      );
    }

    return this.submissionRepo.find({
      where: { assignment_id: assignmentId, tenant_id: ctx.tenantId },
      order: { created_at: 'ASC' },
    });
  }
}
