import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import type { RequestContext } from '../../auth/refresh-token.service';
import { School } from '../../schools/entities/school.entity';
import { PlatformSchoolNote } from '../../support-access/entities/platform-school-note.entity';
import type { SchoolNoteResponseDto } from './dto/school-notes.dto';

const DEFAULT_LIMIT = 50;

const toDto = (n: PlatformSchoolNote): SchoolNoteResponseDto => ({
  id: n.id,
  authorId: n.author_id,
  text: n.body,
  createdAt: n.created_at.toISOString(),
});

/**
 * [Epic 99, D20] Owner's private notes per school. Platform table, never `schools.settings`.
 * Audit rows carry the note id and length only: the school can read its own audit rows.
 */
@Injectable()
export class SchoolNotesService {
  constructor(
    @InjectRepository(PlatformSchoolNote) private readonly notes: Repository<PlatformSchoolNote>,
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly audit: AuditService,
  ) {}

  private async assertSchool(schoolId: string): Promise<void> {
    if (!(await this.schools.exist({ where: { id: schoolId } }))) {
      throw new NotFoundException('School not found');
    }
  }

  async list(schoolId: string, limit = DEFAULT_LIMIT): Promise<SchoolNoteResponseDto[]> {
    await this.assertSchool(schoolId);
    const rows = await this.notes.find({
      where: { tenant_id: schoolId },
      order: { created_at: 'DESC', id: 'DESC' },
      take: Math.min(limit, 100),
    });
    return rows.map(toDto);
  }

  async add(
    schoolId: string,
    text: string,
    actorUserId: string,
    context: RequestContext,
  ): Promise<SchoolNoteResponseDto> {
    await this.assertSchool(schoolId);
    const body = text.trim();
    return this.notes.manager.transaction(async (m) => {
      const note = await m.getRepository(PlatformSchoolNote).save({
        tenant_id: schoolId,
        author_id: actorUserId,
        body,
      });
      await this.audit.record(
        {
          action: AuditAction.PLATFORM_SCHOOL_NOTE_ADDED,
          entity_type: 'PlatformSchoolNote',
          entity_id: note.id,
          tenant_id: schoolId,
          performed_by_user_id: actorUserId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          new_values: { noteId: note.id, length: body.length },
        },
        m,
      );
      return toDto(note as PlatformSchoolNote);
    });
  }

  async remove(
    schoolId: string,
    noteId: string,
    actorUserId: string,
    context: RequestContext,
  ): Promise<void> {
    await this.assertSchool(schoolId);
    await this.notes.manager.transaction(async (m) => {
      const repo = m.getRepository(PlatformSchoolNote);
      // Scoped by school: another school's note is a plain 404, same text as a missing one.
      const note = await repo.findOne({ where: { id: noteId, tenant_id: schoolId } });
      if (!note) throw new NotFoundException('Note not found');
      await repo.delete({ id: noteId, tenant_id: schoolId });
      await this.audit.record(
        {
          action: AuditAction.PLATFORM_SCHOOL_NOTE_ADDED,
          entity_type: 'PlatformSchoolNote',
          entity_id: noteId,
          tenant_id: schoolId,
          performed_by_user_id: actorUserId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          new_values: { noteId, length: note.body.length, deleted: true },
        },
        m,
      );
    });
  }
}
