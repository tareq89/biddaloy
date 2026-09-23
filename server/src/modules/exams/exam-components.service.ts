import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { AuditAction, ExamComponentKind, ExamComponentSource } from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import {
  CreateExamComponentDto,
  UpdateExamComponentDto,
  CopyExamComponentsDto,
} from './dto/exams.dto';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';

export interface CopyComponentsResult {
  copied: { subject_id: string; name: string }[];
  skipped: { subject_id: string; name: string; reason: string }[];
}

@Injectable()
export class ExamComponentsService {
  constructor(
    @InjectRepository(Exam)
    private readonly examRepo: Repository<Exam>,
    @InjectRepository(ExamComponent)
    private readonly repo: Repository<ExamComponent>,
    private readonly auditService: AuditService,
  ) {}

  private async findExam(examId: string, tenantId: string): Promise<Exam> {
    const exam = await this.examRepo.findOne({
      where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!exam) {
      throw new NotFoundException(`Exam with ID "${examId}" not found`);
    }
    return exam;
  }

  /** Shared validation for create/update/copy (issue rules #2 and #5):
   * `pass_marks <= full_marks`, `sequence` unique within exam-subject, and
   * an ATTENDANCE-kind component must be DERIVED with at most one per
   * exam-subject. `excludeId` skips the row being updated when checking
   * uniqueness against itself. */
  private async validate(
    examId: string,
    subjectId: string,
    tenantId: string,
    values: {
      kind: ExamComponentKind;
      source: ExamComponentSource;
      full_marks: string;
      pass_marks: string | null;
      sequence: number;
    },
    excludeId?: string,
  ): Promise<void> {
    if (values.pass_marks !== null && Number(values.pass_marks) > Number(values.full_marks)) {
      throw new BadRequestException('pass_marks cannot exceed full_marks.');
    }

    if (
      values.kind === ExamComponentKind.ATTENDANCE &&
      values.source !== ExamComponentSource.DERIVED
    ) {
      throw new BadRequestException('An ATTENDANCE component must have source = DERIVED.');
    }

    const existing = await this.repo.find({
      where: { exam_id: examId, subject_id: subjectId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    const others = existing.filter((c) => c.id !== excludeId);

    if (others.some((c) => c.sequence === values.sequence)) {
      throw new ConflictException(
        `Sequence ${values.sequence} is already used by another component of this exam-subject.`,
      );
    }

    if (
      values.kind === ExamComponentKind.ATTENDANCE &&
      others.some((c) => c.kind === ExamComponentKind.ATTENDANCE)
    ) {
      throw new ConflictException(
        'This exam-subject already has an ATTENDANCE component — only one is allowed.',
      );
    }
  }

  async create(
    examId: string,
    dto: CreateExamComponentDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<ExamComponent> {
    await this.findExam(examId, tenantId);
    const source = dto.source ?? ExamComponentSource.MANUAL;

    await this.validate(examId, dto.subject_id, tenantId, {
      kind: dto.kind,
      source,
      full_marks: dto.full_marks,
      pass_marks: dto.pass_marks ?? null,
      sequence: dto.sequence,
    });

    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(ExamComponent);
      const entity = repo.create({
        exam_id: examId,
        subject_id: dto.subject_id,
        name: dto.name,
        kind: dto.kind,
        source,
        full_marks: dto.full_marks,
        pass_marks: dto.pass_marks ?? null,
        sequence: dto.sequence,
        tenant_id: tenantId,
      });
      const saved = await repo.save(entity);

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'ExamComponent',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: null,
          new_values: { name: saved.name, kind: saved.kind, subject_id: saved.subject_id },
        },
        manager,
      );

      return saved;
    });
  }

  async findAll(
    examId: string,
    subjectId: string | undefined,
    tenantId: string,
  ): Promise<ExamComponent[]> {
    await this.findExam(examId, tenantId);
    const where: any = { exam_id: examId, tenant_id: tenantId, deleted_at: IsNull() };
    if (subjectId) where.subject_id = subjectId;
    return this.repo.find({ where, order: { sequence: 'ASC' } });
  }

  async findOne(examId: string, id: string, tenantId: string): Promise<ExamComponent> {
    await this.findExam(examId, tenantId);
    const entity = await this.repo.findOne({
      where: { id, exam_id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException(`Exam component with ID "${id}" not found`);
    }
    return entity;
  }

  async update(
    examId: string,
    id: string,
    dto: UpdateExamComponentDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<ExamComponent> {
    const existing = await this.findOne(examId, id, tenantId);

    await this.validate(
      examId,
      existing.subject_id,
      tenantId,
      {
        kind: dto.kind ?? existing.kind,
        source: dto.source ?? existing.source,
        full_marks: dto.full_marks ?? existing.full_marks,
        pass_marks: dto.pass_marks !== undefined ? dto.pass_marks : existing.pass_marks,
        sequence: dto.sequence ?? existing.sequence,
      },
      id,
    );

    const changedKeys = Object.keys(dto);
    if (changedKeys.length > 0) {
      await this.repo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(ExamComponent);
        const oldValues = Object.fromEntries(
          changedKeys.map((key) => [key, (existing as any)[key]]),
        );

        await repo.update({ id, exam_id: examId, tenant_id: tenantId }, dto);

        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'ExamComponent',
            entity_id: id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: oldValues,
            new_values: { ...dto },
          },
          manager,
        );
      });
    }

    return this.findOne(examId, id, tenantId);
  }

  async remove(
    examId: string,
    id: string,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    const existing = await this.findOne(examId, id, tenantId);

    await this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(ExamComponent);
      await repo.softDelete({ id, exam_id: examId, tenant_id: tenantId });

      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'ExamComponent',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { name: existing.name },
          new_values: null,
        },
        manager,
      );
    });
  }

  /**
   * Additive copy (issue rule #3): copies every component from
   * (`source_exam_id`, `source_subject_id`) into each of `target_subject_ids`
   * within `examId`. Never overwrites — a target subject that already has a
   * component of the same name is skipped and reported, not merged. Sequence
   * is reassigned per target (source sequence isn't reused) so the copy
   * never collides with a target's own existing sequence.
   */
  async copy(
    examId: string,
    dto: CopyExamComponentsDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<CopyComponentsResult> {
    await this.findExam(examId, tenantId);
    // The source exam only needs to belong to the same tenant — it may be
    // this exam (copying across subjects) or a different one (copying
    // across exams), see the issue's "source = another subject in the
    // same exam, or the same subject in another exam".
    await this.findExam(dto.source_exam_id, tenantId);

    const sourceComponents = await this.repo.find({
      where: {
        exam_id: dto.source_exam_id,
        subject_id: dto.source_subject_id,
        tenant_id: tenantId,
        deleted_at: IsNull(),
      },
      order: { sequence: 'ASC' },
    });

    const result: CopyComponentsResult = { copied: [], skipped: [] };

    for (const targetSubjectId of dto.target_subject_ids) {
      const existingTarget = await this.repo.find({
        where: {
          exam_id: examId,
          subject_id: targetSubjectId,
          tenant_id: tenantId,
          deleted_at: IsNull(),
        },
      });
      const existingNames = new Set(existingTarget.map((c) => c.name));
      let nextSequence = existingTarget.reduce((max, c) => Math.max(max, c.sequence), 0) + 1;
      let attendanceAlready = existingTarget.some((c) => c.kind === ExamComponentKind.ATTENDANCE);

      for (const source of sourceComponents) {
        if (existingNames.has(source.name)) {
          result.skipped.push({
            subject_id: targetSubjectId,
            name: source.name,
            reason: 'A component with this name already exists for this exam-subject.',
          });
          continue;
        }
        if (source.kind === ExamComponentKind.ATTENDANCE && attendanceAlready) {
          result.skipped.push({
            subject_id: targetSubjectId,
            name: source.name,
            reason: 'This exam-subject already has an ATTENDANCE component.',
          });
          continue;
        }

        await this.repo.manager.transaction(async (manager) => {
          const repo = manager.getRepository(ExamComponent);
          const entity = repo.create({
            exam_id: examId,
            subject_id: targetSubjectId,
            name: source.name,
            kind: source.kind,
            source: source.source,
            full_marks: source.full_marks,
            pass_marks: source.pass_marks,
            sequence: nextSequence,
            tenant_id: tenantId,
          });
          const saved = await repo.save(entity);

          await this.auditService.record(
            {
              action: AuditAction.CREATE,
              entity_type: 'ExamComponent',
              entity_id: saved.id,
              tenant_id: tenantId,
              performed_by_user_id: userId,
              ip_address: context.ip,
              user_agent: context.userAgent,
              old_values: null,
              new_values: {
                name: saved.name,
                kind: saved.kind,
                subject_id: saved.subject_id,
                copied_from: source.id,
              },
            },
            manager,
          );
        });

        existingNames.add(source.name);
        if (source.kind === ExamComponentKind.ATTENDANCE) attendanceAlready = true;
        nextSequence += 1;
        result.copied.push({ subject_id: targetSubjectId, name: source.name });
      }
    }

    return result;
  }
}
