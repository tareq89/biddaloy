import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ExamStatus,
  FinalResultStatus,
  PromotionRunStatus,
  RoleScope,
  roleScope,
} from '@biddaloy/shared';
import { PromotionRun } from './entities/promotion-run.entity';
import { PromotionEntry } from './entities/promotion-entry.entity';
import { PromotionsService } from './promotions.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { SchoolSettingsReader } from '../schools/settings/school-settings-reader.service';
import { ListPromotionGroupsQueryDto, PatchPromotionEntryDto } from './dto/promotions.dto';

/** [69.4.01] D8/D16: where a student's shown result came from. */
export type GroupResultSource = 'FINAL_RESULT' | 'EXAM' | null;

export interface GroupResultSubject {
  subject_code: string;
  marks: number;
  grade: string;
}

export interface GroupResult {
  gpa: number | null;
  subjects: GroupResultSubject[];
  source: GroupResultSource;
}

export interface PromotionGroupEntryView {
  entry_id: string;
  student_id: string;
  student_name: string | null;
  source_section_id: string | null;
  source_section_name: string | null;
  group_name: string | null;
  result: GroupResult;
}

interface Actor {
  tenantId: string;
  role: string;
  userId: string;
}

interface SourceRow {
  student_id: string;
  gpa: string;
  subjects: GroupResultSubject[];
}

type ParentRow = { id: string; student_id: string; gpa: string };
type SubjectRow = { parent_id: string; subject_code: string; marks: string; grade: string };

const EMPTY_RESULT: GroupResult = { gpa: null, subjects: [], source: null };

/** D16: a published final result wins over the latest published exam; neither gives an empty result. */
export function pickResult(final: SourceRow | undefined, exam: SourceRow | undefined): GroupResult {
  if (final) return { gpa: Number(final.gpa), subjects: final.subjects, source: 'FINAL_RESULT' };
  if (exam) return { gpa: Number(exam.gpa), subjects: exam.subjects, source: 'EXAM' };
  return EMPTY_RESULT;
}

/** Server-side filters. A student with no result never matches an active filter. */
export function matchesFilters(
  result: GroupResult,
  q: Pick<ListPromotionGroupsQueryDto, 'gpa_min' | 'gpa_max' | 'subject_code' | 'marks_min'>,
): boolean {
  const hasFilter = [q.gpa_min, q.gpa_max, q.subject_code, q.marks_min].some(
    (v) => v !== undefined,
  );
  if (!hasFilter) return true;
  if (result.gpa === null) return false;
  if (q.gpa_min !== undefined && result.gpa < q.gpa_min) return false;
  if (q.gpa_max !== undefined && result.gpa > q.gpa_max) return false;
  if (q.subject_code !== undefined) {
    const subject = result.subjects.find((s) => s.subject_code === q.subject_code);
    if (!subject) return false;
    if (q.marks_min !== undefined && subject.marks < q.marks_min) return false;
  }
  return true;
}

/**
 * [69.4.01] Groups step of a draft promotion run: read every entry with the student's result,
 * set the group on many at once. The write goes through `PromotionsService.patchEntries`
 * (DRAFT check, closed-year guard, row lock, placement re-run), so there is one write path.
 */
@Injectable()
export class PromotionGroupsService {
  constructor(
    @InjectRepository(PromotionRun) private readonly runRepo: Repository<PromotionRun>,
    @InjectRepository(PromotionEntry) private readonly entryRepo: Repository<PromotionEntry>,
    private readonly promotions: PromotionsService,
    private readonly teacherScope: TeacherScopeService,
    private readonly settingsReader: SchoolSettingsReader,
  ) {}

  /** `null` = no restriction; array = the caller's homeroom sections (class / assistant teacher). */
  private async allowedSections(actor: Actor): Promise<string[] | null> {
    if (roleScope(actor.role) !== RoleScope.ASSIGNED_SECTIONS) return null;
    const rows = await this.teacherScope.homeroomSections({
      userId: actor.userId,
      tenantId: actor.tenantId,
    });
    return rows.map((r) => r.section_id);
  }

  private async loadRun(runId: string, tenantId: string): Promise<PromotionRun> {
    const run = await this.runRepo.findOne({ where: { id: runId, tenant_id: tenantId } });
    if (!run) throw new NotFoundException('Promotion run not found');
    return run;
  }

  async list(runId: string, query: ListPromotionGroupsQueryDto, actor: Actor) {
    const run = await this.loadRun(runId, actor.tenantId);
    const allowed = await this.allowedSections(actor);
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 100);

    // Teacher with no homeroom: an empty list, not an error (Rule 2).
    if (allowed !== null && allowed.length === 0) return { data: [], total: 0, page, limit };

    const entries = await this.entryRepo.find({
      where: {
        run_id: run.id,
        tenant_id: actor.tenantId,
        ...(allowed !== null ? { source_section_id: In(allowed) } : {}),
      },
      order: { merit_rank: { direction: 'ASC', nulls: 'LAST' } },
    });
    // Teacher with a homeroom, but none of this run's entries sit in it: the run is not theirs.
    if (allowed !== null && entries.length === 0) {
      throw new NotFoundException('Promotion run not found');
    }

    const studentIds = entries.map((e) => e.student_id);
    const [names, finals, exams] = await Promise.all([
      this.names(entries, actor.tenantId),
      this.finalRows(run, studentIds, actor.tenantId),
      this.examRows(run, studentIds, actor.tenantId),
    ]);

    // ponytail: filters run in memory over one class cohort (hundreds); move to SQL if cohorts grow.
    const all = entries
      .map<PromotionGroupEntryView>((e) => ({
        entry_id: e.id,
        student_id: e.student_id,
        student_name: names.students.get(e.student_id) ?? null,
        source_section_id: e.source_section_id,
        source_section_name: e.source_section_id
          ? (names.sections.get(e.source_section_id) ?? null)
          : null,
        group_name: e.group_name,
        result: pickResult(finals.get(e.student_id), exams.get(e.student_id)),
      }))
      .filter((v) => matchesFilters(v.result, query));

    return { data: all.slice((page - 1) * limit, page * limit), total: all.length, page, limit };
  }

  async set(runId: string, entryIds: string[], groupName: string | null, actor: Actor) {
    const run = await this.loadRun(runId, actor.tenantId);
    if (run.status !== PromotionRunStatus.DRAFT) {
      throw new ConflictException('Only DRAFT runs can be edited');
    }

    const vocabulary = (await this.settingsReader.organisationVocabulary(actor.tenantId)).groups;
    if (vocabulary.length === 0) {
      throw new UnprocessableEntityException({
        message: 'No groups are configured for this school.',
        details: { code: 'GROUPS_NOT_CONFIGURED' },
      });
    }
    if (groupName !== null && !vocabulary.includes(groupName)) {
      // Fixed sentence: never echo the submitted value (Rule 23).
      throw new UnprocessableEntityException({
        message: 'The group is not one of the configured groups.',
        details: { code: 'GROUP_NOT_IN_VOCABULARY' },
      });
    }

    const entries = await this.entryRepo.find({
      where: { id: In(entryIds), run_id: run.id, tenant_id: actor.tenantId },
    });
    const allowed = await this.allowedSections(actor);
    const outOfScope =
      allowed !== null &&
      entries.some((e) => !e.source_section_id || !allowed.includes(e.source_section_id));
    // One answer for "not in this run" and "not your section": nothing is updated either way.
    if (entries.length !== entryIds.length || outOfScope) {
      throw new NotFoundException('Promotion entries not found');
    }

    await this.promotions.patchEntries(
      run.id,
      entries.map(
        (e) => ({ student_id: e.student_id, group_name: groupName }) as PatchPromotionEntryDto,
      ),
      actor.tenantId,
      actor.userId,
    );
    return { updated: entries.length };
  }

  private async names(entries: PromotionEntry[], tenantId: string) {
    const manager = this.runRepo.manager;
    const students = new Map<string, string>();
    const sections = new Map<string, string>();
    const studentIds = entries.map((e) => e.student_id);
    const sectionIds = [...new Set(entries.map((e) => e.source_section_id).filter(Boolean))];
    if (studentIds.length) {
      const rows: { id: string; full_name: string }[] = await manager.query(
        `SELECT id, full_name FROM students WHERE tenant_id = $1 AND id = ANY($2)`,
        [tenantId, studentIds],
      );
      rows.forEach((r) => students.set(r.id, r.full_name));
    }
    if (sectionIds.length) {
      const rows: { id: string; section_name: string }[] = await manager.query(
        `SELECT id, section_name FROM class_sections WHERE tenant_id = $1 AND id = ANY($2)`,
        [tenantId, sectionIds],
      );
      rows.forEach((r) => sections.set(r.id, r.section_name));
    }
    return { students, sections };
  }

  /** The source class's PUBLISHED final result for its year, per student (D8). */
  private async finalRows(run: PromotionRun, studentIds: string[], tenantId: string) {
    const manager = this.runRepo.manager;
    const [final]: { id: string }[] = await manager.query(
      `SELECT id FROM final_results
        WHERE tenant_id = $1 AND class_id = $2 AND academic_year_id = $3
          AND status = $4 AND deleted_at IS NULL LIMIT 1`,
      [tenantId, run.source_class_id, run.source_academic_year_id, FinalResultStatus.PUBLISHED],
    );
    if (!final || !studentIds.length) return new Map<string, SourceRow>();
    const rows: ParentRow[] = await manager.query(
      `SELECT id, student_id, gpa FROM final_result_rows
        WHERE tenant_id = $1 AND final_result_id = $2 AND student_id = ANY($3) AND deleted_at IS NULL`,
      [tenantId, final.id, studentIds],
    );
    const subjects: SubjectRow[] = rows.length
      ? await manager.query(
          `SELECT fs.final_result_row_id AS parent_id, sub.code AS subject_code, fs.obtained AS marks, fs.grade
             FROM final_result_subjects fs
             JOIN subjects sub ON sub.id = fs.subject_id AND sub.tenant_id = $1
            WHERE fs.tenant_id = $1 AND fs.final_result_row_id = ANY($2) AND fs.deleted_at IS NULL`,
          [tenantId, rows.map((r) => r.id)],
        )
      : [];
    return this.assemble(rows, subjects);
  }

  /** The latest PUBLISHED exam of the source class in its year, per student (D16). */
  private async examRows(run: PromotionRun, studentIds: string[], tenantId: string) {
    const manager = this.runRepo.manager;
    const [exam]: { id: string }[] = await manager.query(
      `SELECT id FROM exams
        WHERE tenant_id = $1 AND class_id = $2 AND academic_year_id = $3
          AND status = $4 AND deleted_at IS NULL
        ORDER BY published_at DESC NULLS LAST, created_at DESC LIMIT 1`,
      [tenantId, run.source_class_id, run.source_academic_year_id, ExamStatus.PUBLISHED],
    );
    if (!exam || !studentIds.length) return new Map<string, SourceRow>();
    const rows: ParentRow[] = await manager.query(
      `SELECT id, student_id, gpa FROM results
        WHERE tenant_id = $1 AND exam_id = $2 AND student_id = ANY($3) AND deleted_at IS NULL`,
      [tenantId, exam.id, studentIds],
    );
    const subjects: SubjectRow[] = rows.length
      ? await manager.query(
          `SELECT rs.result_id AS parent_id, sub.code AS subject_code, rs.obtained AS marks, rs.grade
             FROM result_subjects rs
             JOIN subjects sub ON sub.id = rs.subject_id AND sub.tenant_id = $1
            WHERE rs.tenant_id = $1 AND rs.result_id = ANY($2) AND rs.deleted_at IS NULL`,
          [tenantId, rows.map((r) => r.id)],
        )
      : [];
    return this.assemble(rows, subjects);
  }

  private assemble(rows: ParentRow[], subjects: SubjectRow[]): Map<string, SourceRow> {
    return new Map(
      rows.map((r) => [
        r.student_id,
        {
          student_id: r.student_id,
          gpa: r.gpa,
          subjects: subjects
            .filter((s) => s.parent_id === r.id)
            .map((s) => ({
              subject_code: s.subject_code,
              marks: Number(s.marks),
              grade: s.grade,
            })),
        },
      ]),
    );
  }
}
