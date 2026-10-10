import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import {
  Permission,
  STUDY_PLAN_CSV_COLUMNS,
  STUDY_PLAN_LIMITS,
  hasTenantDataScope,
  roleHasPermission,
  toCsvContent,
} from '@biddaloy/shared';
import type { StudyPlanLesson } from '@biddaloy/shared';
import { StudyPlan } from './entities/study-plan.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { Subject } from '../academics/entities/subject.entity';
import { SyllabusTopic } from '../homework/entities/syllabus-topic.entity';
import { ImportStagingService } from '../bulk-import/import-staging.service';
import type { BulkImportErrorDto } from '../bulk-import/dto/bulk-import.dto';
import { StudyPlansService, StudyPlanCaller } from './study-plans.service';
import { PlanScheduleService } from './plan-schedule.service';
import { StudyPlanTemplatesService } from './study-plan-templates.service';
import { ParsedLessonRow, StudyPlanParseError, parseLessonSheet } from './study-plan-csv.parser';
import {
  CommitStudyPlanImportDto,
  ProgressCsvQueryDto,
  StudyPlanImportPreviewRowDto,
  StudyPlanImportValidateResultDto,
  ValidateStudyPlanImportDto,
} from './dto/study-plan-import.dto';

/** A `{ csv, filename }` pair the controller turns into a download. */
export interface CsvFile {
  csv: string;
  filename: string;
}

/** What `validate` stages under a `staging_id`; JSON round-trips through Redis. */
interface StagedImport {
  filename: string;
  /** Which pair `validate` was called with — commit must match it. */
  kind: 'plan' | 'template';
  classId?: string;
  subjectId?: string;
  classGrade?: number;
  subjectCode?: string;
  lessons: StudyPlanLesson[];
  hardErrorCount: number;
}

const forbidden = (message: string) => new ForbiddenException({ message });

/** Case-insensitive, trimmed key used to match a `topic` cell to a topic name. */
const topicKey = (name: string) => name.trim().toLowerCase();

/** `lessons.csv`, import validate/commit and the progress CSV (66.2.07 / D4, D22, D42, D45). */
@Injectable()
export class StudyPlanCsvService {
  constructor(
    @InjectRepository(SyllabusTopic) private readonly topicRepo: Repository<SyllabusTopic>,
    @InjectRepository(ClassSection) private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Class) private readonly classRepo: Repository<Class>,
    @InjectRepository(Subject) private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(StudyPlan) private readonly planRepo: Repository<StudyPlan>,
    @Inject(ImportStagingService) private readonly staging: ImportStagingService,
    private readonly plans: StudyPlansService,
    private readonly schedule: PlanScheduleService,
    private readonly templates: StudyPlanTemplatesService,
  ) {}

  // ------------------------------------------------------------------ export

  /** Pure: lessons → CSV text. `topicNames` maps topic id → name. */
  buildLessonsCsv(lessons: StudyPlanLesson[], topicNames: Map<string, string>): string {
    return toCsvContent([
      [...STUDY_PLAN_CSV_COLUMNS],
      ...lessons.map((l) => [
        l.title,
        l.periods,
        l.topic_id ? (topicNames.get(l.topic_id) ?? '') : '',
        l.notes ?? '',
      ]),
    ]);
  }

  async exportLessons(planId: string, tenantId: string, caller: StudyPlanCaller): Promise<CsvFile> {
    // findOneForCaller is the read check (D9): 404 across tenants, 403 out of scope.
    const plan = await this.plans.findOneForCaller(planId, tenantId, caller);
    const ids = [...new Set(plan.lessons.map((l) => l.topic_id).filter((x): x is string => !!x))];
    const topics = ids.length
      ? await this.topicRepo.find({ where: { tenant_id: tenantId, id: In(ids) } })
      : [];
    return {
      csv: this.buildLessonsCsv(plan.lessons, new Map(topics.map((t) => [t.id, t.name]))),
      filename: `study-plan-lessons-${plan.section.class_name}-${plan.subject.code}.csv`,
    };
  }

  // ---------------------------------------------------------------- validate

  /** D42: the importer must be able to write plans or templates. */
  private assertCanImport(role: string): void {
    if (
      !roleHasPermission(role, Permission.SYLLABUS_MANAGE) &&
      !roleHasPermission(role, Permission.STUDY_PLAN_TEMPLATE_MANAGE)
    ) {
      throw forbidden('You cannot import study plan lessons.');
    }
  }

  /** Row rules shared by both targets; returns the lesson or an error message + column. */
  private checkRow(
    row: ParsedLessonRow,
  ): { lesson: StudyPlanLesson } | { message: string; column: string; value?: string } {
    const L = STUDY_PLAN_LIMITS;
    const { title, periods, notes } = row.values;
    if (title.length < 1 || title.length > L.titleMax) {
      return {
        message: `title must be 1-${L.titleMax} characters`,
        column: 'title',
        value: title || undefined,
      };
    }
    if (
      !/^\d+$/.test(periods) ||
      Number(periods) < L.periodsMin ||
      Number(periods) > L.periodsMax
    ) {
      return {
        message: `periods must be a whole number ${L.periodsMin}-${L.periodsMax}`,
        column: 'periods',
        value: periods || undefined,
      };
    }
    if (notes.length > L.notesMax) {
      return { message: `notes are at most ${L.notesMax} characters`, column: 'notes' };
    }
    const lesson: StudyPlanLesson = { id: randomUUID(), title, periods: Number(periods) };
    if (notes) lesson.notes = notes;
    return { lesson };
  }

  async validate(
    file: Express.Multer.File | undefined,
    body: ValidateStudyPlanImportDto,
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<StudyPlanImportValidateResultDto> {
    this.assertCanImport(caller.role);
    if (!file) throw new BadRequestException('No file uploaded');

    const hasPlanPair = body.class_id !== undefined || body.subject_id !== undefined;
    const hasTemplatePair = body.class_grade !== undefined || body.subject_code !== undefined;
    if (hasPlanPair === hasTemplatePair) {
      throw new BadRequestException(
        'Send either class_id + subject_id (plan) or class_grade + subject_code (template).',
      );
    }
    const kind: StagedImport['kind'] = hasPlanPair ? 'plan' : 'template';
    // The target type decides the permission up front (D45): a TEACHER holds
    // SYLLABUS_MANAGE but may not add to the library.
    if (kind === 'plan') {
      if (!roleHasPermission(caller.role, Permission.SYLLABUS_MANAGE)) {
        throw forbidden('You cannot import lessons into a study plan.');
      }
      if (!body.class_id || !body.subject_id) {
        throw new BadRequestException('class_id and subject_id are both required.');
      }
    } else {
      if (!roleHasPermission(caller.role, Permission.STUDY_PLAN_TEMPLATE_MANAGE)) {
        throw forbidden('You cannot import lessons into the template library.');
      }
      if (body.class_grade === undefined || !body.subject_code) {
        throw new BadRequestException('class_grade and subject_code are both required.');
      }
    }

    let rows: ParsedLessonRow[];
    try {
      rows = await parseLessonSheet(file.buffer, file.originalname);
    } catch (err) {
      if (err instanceof StudyPlanParseError) throw new BadRequestException(err.message);
      throw err;
    }

    // Plan target: class and subject must be this tenant's; topics resolve by name.
    const topicIdByName = new Map<string, string>();
    if (kind === 'plan') {
      const [cls, subject] = await Promise.all([
        this.classRepo.findOne({ where: { id: body.class_id, tenant_id: tenantId } }),
        this.subjectRepo.findOne({ where: { id: body.subject_id, tenant_id: tenantId } }),
      ]);
      if (!cls) throw new NotFoundException('Class not found.');
      if (!subject) throw new NotFoundException('Subject not found.');
      const topics = await this.topicRepo.find({
        where: { tenant_id: tenantId, class_id: cls.id, subject_id: subject.id },
        order: { sequence: 'ASC' },
      });
      // First topic wins when two share a name.
      for (const t of topics)
        if (!topicIdByName.has(topicKey(t.name))) topicIdByName.set(topicKey(t.name), t.id);
    }

    const errors: BulkImportErrorDto[] = [];
    const warnings: BulkImportErrorDto[] = [];
    const lessons: StudyPlanLesson[] = [];
    const preview: StudyPlanImportPreviewRowDto[] = [];
    for (const row of rows) {
      const checked = this.checkRow(row);
      if ('message' in checked) {
        errors.push({
          row: row.rowNumber,
          column: checked.column,
          value: checked.value,
          severity: 'error',
          message: checked.message,
        });
        continue;
      }
      const topic = row.values.topic;
      if (topic) {
        if (kind === 'template') {
          warnings.push({
            row: row.rowNumber,
            column: 'topic',
            value: topic,
            severity: 'warning',
            message: 'topics are not kept in templates',
          });
        } else {
          const id = topicIdByName.get(topicKey(topic));
          if (id) checked.lesson.topic_id = id;
          else {
            warnings.push({
              row: row.rowNumber,
              column: 'topic',
              value: topic,
              severity: 'warning',
              message: `Topic '${topic}' not found for this class and subject — the link is dropped`,
            });
          }
        }
      }
      lessons.push(checked.lesson);
      preview.push({
        row: row.rowNumber,
        title: checked.lesson.title,
        periods: checked.lesson.periods,
        ...(topic ? { topic } : {}),
      });
    }

    const payload: StagedImport = {
      filename: file.originalname,
      kind,
      classId: body.class_id,
      subjectId: body.subject_id,
      classGrade: body.class_grade,
      subjectCode: body.subject_code,
      lessons,
      hardErrorCount: errors.length,
    };
    const { stagingId, expiresAt } = await this.staging.stage(tenantId, caller.userId, payload);
    return {
      staging_id: stagingId,
      expires_at: expiresAt,
      rows_to_create: lessons.length,
      preview: preview.slice(0, 20),
      errors,
      warnings,
      hard_error_count: errors.length,
    };
  }

  // ------------------------------------------------------------------ commit

  /**
   * Permission and target checks run on a `peek`, and the id is `consume`d only
   * after the write succeeds: a refused write (409, 400) leaves the upload for a
   * retry; a committed one is gone (404 after).
   */
  async commit(dto: CommitStudyPlanImportDto, tenantId: string, caller: StudyPlanCaller) {
    const targets = [dto.plan_id, dto.plan, dto.template].filter((t) => t !== undefined);
    if (targets.length !== 1) {
      throw new BadRequestException('Send exactly one of plan_id, plan or template.');
    }
    const staged = await this.staging.peek<StagedImport>(tenantId, caller.userId, dto.staging_id);
    if (!staged) throw this.stagingGone();
    if (staged.hardErrorCount > 0) {
      throw new ConflictException(
        'This staged upload had validation errors and cannot be committed. Re-validate the file first.',
      );
    }

    if (dto.template) {
      if (!roleHasPermission(caller.role, Permission.STUDY_PLAN_TEMPLATE_MANAGE)) {
        throw forbidden('You cannot add to the template library.');
      }
      if (
        staged.kind !== 'template' ||
        staged.classGrade !== dto.template.class_grade ||
        staged.subjectCode !== dto.template.subject_code
      ) {
        throw new BadRequestException(
          'This upload was validated for a different target. Validate it again for the template.',
        );
      }
      return this.consumeAfter(
        tenantId,
        caller,
        dto.staging_id,
        this.templates.create(
          {
            name: dto.template.name,
            class_grade: dto.template.class_grade,
            subject_code: dto.template.subject_code,
            lessons: staged.lessons,
          },
          tenantId,
          caller.userId,
          caller.context,
        ),
      );
    }

    // Plan targets: SYLLABUS_MANAGE here; the owner scope is the service's.
    if (!roleHasPermission(caller.role, Permission.SYLLABUS_MANAGE)) {
      throw forbidden('You cannot import lessons into a study plan.');
    }
    if (staged.kind !== 'plan') {
      throw new BadRequestException(
        'This upload was validated for a template, not a study plan. Validate it again.',
      );
    }

    if (dto.plan_id) {
      const plan = await this.plans.findOneForCaller(dto.plan_id, tenantId, caller);
      if (plan.section.class_id !== staged.classId || plan.subject.id !== staged.subjectId) {
        throw new BadRequestException(
          'This upload was validated for a different class and subject than the plan.',
        );
      }
      // Owner scope before burning the staging id (replaceLessons re-checks it).
      await this.plans.assertCanWrite(
        caller,
        plan.section.id,
        plan.subject.id,
        plan.academic_year_id,
        plan.owner_override_teacher_id,
      );
      // A row whose title matches an existing lesson keeps that lesson's id, so
      // exam markers and delivery history survive an export -> edit -> import.
      const idsByTitle = new Map<string, string[]>();
      for (const l of plan.lessons)
        idsByTitle.set(l.title, [...(idsByTitle.get(l.title) ?? []), l.id]);
      const lessons = staged.lessons.map((l) => {
        const id = idsByTitle.get(l.title)?.shift();
        return id ? { ...l, id } : l;
      });
      return this.consumeAfter(
        tenantId,
        caller,
        dto.staging_id,
        this.plans.replaceLessons(dto.plan_id, lessons, tenantId, caller),
      );
    }

    const scope = dto.plan!;
    const section = await this.sectionRepo.findOne({
      where: { id: scope.section_id, tenant_id: tenantId },
    });
    if (!section) throw new NotFoundException('Section not found.');
    if (section.class_id !== staged.classId || scope.subject_id !== staged.subjectId) {
      throw new BadRequestException(
        'This upload was validated for a different class and subject than the new plan.',
      );
    }
    const cls = await this.classRepo.findOne({
      where: { id: section.class_id, tenant_id: tenantId },
    });
    if (!cls) throw new NotFoundException('Class not found.');
    await this.plans.assertCanWrite(caller, section.id, scope.subject_id, cls.academic_year_id);
    return this.consumeAfter(
      tenantId,
      caller,
      dto.staging_id,
      this.plans.create(
        {
          section_id: scope.section_id,
          subject_id: scope.subject_id,
          academic_term_id: scope.academic_term_id,
          lessons: staged.lessons,
        },
        tenantId,
        caller,
      ),
    );
  }

  private stagingGone() {
    return new NotFoundException(
      'No staged upload found for this id. It may have expired or already been committed.',
    );
  }

  /**
   * Burns the staging id once `write` has succeeded; a failed write leaves it.
   * ponytail: two racing commits of one id can both write (the plan/template
   * unique keys turn the second create into a 409); lock the id if that matters.
   */
  private async consumeAfter<T>(
    tenantId: string,
    caller: StudyPlanCaller,
    stagingId: string,
    write: Promise<T>,
  ): Promise<T> {
    const out = await write;
    await this.staging.consume<StagedImport>(tenantId, caller.userId, stagingId);
    return out;
  }

  // ---------------------------------------------------------------- progress

  /** D22/D45: one row per live plan of a class and term; tenant-wide readers only. */
  async progressCsv(
    query: ProgressCsvQueryDto,
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<CsvFile> {
    if (
      !hasTenantDataScope(caller.role) ||
      !roleHasPermission(caller.role, Permission.SYLLABUS_READ)
    ) {
      throw forbidden('Only school-wide readers can download the progress report.');
    }

    // findAll filters tenant_id, so another tenant's class id gives no rows.
    const bases = [];
    for (let page = 1; ; page++) {
      const res = await this.plans.findAll(
        { class_id: query.class_id, academic_term_id: query.academic_term_id, page, limit: 100 },
        tenantId,
        caller,
      );
      bases.push(...res.data);
      if (page >= res.totalPages) break;
    }
    const entities = bases.length
      ? await this.planRepo.find({ where: { tenant_id: tenantId, id: In(bases.map((b) => b.id)) } })
      : [];
    const byId = new Map(entities.map((e) => [e.id, e]));

    const rows: unknown[][] = [
      [
        'section',
        'subject',
        'owners',
        'lessons_done',
        'lessons_total',
        'periods_taught',
        'periods_owed',
        'periods_behind',
        'lessons_behind',
        'unreported_school_days',
        'last_taught_lesson',
      ],
    ];
    // One resolver pass per section; a plan whose term or year was removed has no schedule.
    const scheds = await this.schedule.schedulesFor(entities, tenantId);
    for (const base of bases) {
      if (!byId.has(base.id)) continue;
      const detail = await this.plans.findOneForCaller(base.id, tenantId, caller);
      const sched = scheds.get(base.id) ?? null;
      const taughtLessons = sched?.raw.lessons.filter((l) => l.status === 'DONE') ?? [];
      rows.push([
        `${base.section.class_name} ${base.section.name}`,
        base.subject.name_en,
        detail.owners.map((o) => o.full_name).join('; '),
        sched?.summary.lessons_done ?? 0,
        sched?.summary.lessons_total ?? base.lesson_count,
        sched?.raw.taught ?? 0,
        sched?.raw.owed_by_today ?? 0,
        sched?.summary.periods_behind ?? 0,
        sched?.summary.lessons_behind ?? 0,
        sched?.summary.unreported_school_days ?? 0,
        taughtLessons.length ? taughtLessons[taughtLessons.length - 1].title : '',
      ]);
    }
    return {
      csv: toCsvContent(rows),
      filename: `study-plan-progress-${query.class_id}-${query.academic_term_id}.csv`,
    };
  }
}
