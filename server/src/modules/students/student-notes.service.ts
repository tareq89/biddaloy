import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AuditAction, UserRole } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { teacherCanSeeStudent } from '../classes/teacher-scope.service';
import { Student } from './entities/student.entity';
import { StudentNote } from './entities/student-note.entity';
import { CreateStudentNoteDto, StudentNoteResponseDto } from './dto/student-notes.dto';

export interface NoteCaller {
  userId: string;
  role: string;
  tenantId: string;
}

/**
 * [39.2.1] Staff-only notes on a student (D4, D29): create, list, soft-delete
 * by author or ADMIN. No edit. Never reachable by PARENT/STUDENT — the
 * controller's @Roles keeps them out, and nothing here is exposed via
 * FamilyAccessService or /students/mine.
 */
@Injectable()
export class StudentNotesService {
  constructor(
    @InjectRepository(StudentNote) private readonly notes: Repository<StudentNote>,
    @InjectRepository(Student) private readonly students: Repository<Student>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  /**
   * 404 if the student isn't in this tenant, and also for a TEACHER with no live
   * row in the student's section in the current academic year (Epic 75 D13; the
   * shared `teacherCanSeeStudent` free function, since StudentModule can't import ClassModule).
   */
  private async assertStudentAccess(studentId: string, caller: NoteCaller): Promise<Student> {
    const student = await this.students.findOne({
      where: { id: studentId, tenant_id: caller.tenantId, deleted_at: IsNull() },
    });
    if (!student)
      throw new NotFoundException({
        message: 'Student not found',
        details: { code: 'STUDENT_NOT_FOUND' },
      });

    if (
      caller.role === UserRole.TEACHER &&
      !(await teacherCanSeeStudent(this.dataSource.manager, {
        userId: caller.userId,
        tenantId: caller.tenantId,
        studentId,
      }))
    ) {
      throw new NotFoundException({
        message: 'Student not found',
        details: { code: 'STUDENT_NOT_FOUND' },
      });
    }
    return student;
  }

  async list(studentId: string, caller: NoteCaller): Promise<StudentNoteResponseDto[]> {
    await this.assertStudentAccess(studentId, caller);
    const rows: Array<{
      id: string;
      body: string;
      rating: number | null;
      created_at: Date;
      author_id: string;
      name: string | null;
    }> = await this.dataSource.query(
      `SELECT n.id, n.body, n.rating, n.created_at, n.author_user_id AS author_id, u.full_name AS name
           FROM student_notes n LEFT JOIN users u ON u.id = n.author_user_id
          WHERE n.tenant_id = $1 AND n.student_id = $2 AND n.deleted_at IS NULL
          ORDER BY n.created_at DESC, n.id`,
      [caller.tenantId, studentId],
    );
    return rows.map((r) => ({
      id: r.id,
      body: r.body,
      rating: r.rating ?? null,
      author: { id: r.author_id, name: r.name ?? '' },
      created_at: r.created_at,
    }));
  }

  async create(
    studentId: string,
    dto: CreateStudentNoteDto,
    caller: NoteCaller,
    ctx?: RequestContext,
  ): Promise<StudentNoteResponseDto> {
    await this.assertStudentAccess(studentId, caller);
    const note = await this.notes.save(
      this.notes.create({
        tenant_id: caller.tenantId,
        student_id: studentId,
        author_user_id: caller.userId,
        body: dto.body.trim(),
        rating: dto.rating ?? null,
      }),
    );
    // The note body is deliberately not copied into the audit row.
    await this.audit.record({
      action: AuditAction.CREATE,
      entity_type: 'Student',
      entity_id: studentId,
      tenant_id: caller.tenantId,
      performed_by_user_id: caller.userId,
      ip_address: ctx?.ip ?? null,
      user_agent: ctx?.userAgent ?? null,
      new_values: { note_id: note.id },
    });
    const [u] = await this.dataSource.query(`SELECT full_name FROM users WHERE id = $1`, [
      caller.userId,
    ]);
    return {
      id: note.id,
      body: note.body,
      rating: note.rating ?? null,
      author: { id: caller.userId, name: u?.full_name ?? '' },
      created_at: note.created_at,
    };
  }

  /** Author or ADMIN only; soft delete. */
  async remove(
    studentId: string,
    noteId: string,
    caller: NoteCaller,
    ctx?: RequestContext,
  ): Promise<void> {
    await this.assertStudentAccess(studentId, caller);
    const note = await this.notes.findOne({
      where: { id: noteId, student_id: studentId, tenant_id: caller.tenantId },
    });
    if (!note) throw new NotFoundException('Note not found');
    if (caller.role !== UserRole.ADMIN && note.author_user_id !== caller.userId) {
      throw new ForbiddenException('Only the author or an admin can delete a note');
    }
    await this.notes.softDelete({ id: note.id, tenant_id: caller.tenantId });
    await this.audit.record({
      action: AuditAction.DELETE,
      entity_type: 'Student',
      entity_id: studentId,
      tenant_id: caller.tenantId,
      performed_by_user_id: caller.userId,
      ip_address: ctx?.ip ?? null,
      user_agent: ctx?.userAgent ?? null,
      old_values: { note_id: note.id },
    });
  }
}
