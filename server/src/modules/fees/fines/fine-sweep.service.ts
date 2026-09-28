import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { School } from '../../schools/entities/school.entity';
import { FineRule } from '../entities/fine-rule.entity';
import { FeeStructure } from '../entities/fee-structure.entity';
import { StudentFee } from '../entities/student-fee.entity';
import { FeeGenerationService } from '../fee-generation.service';
import { SchoolCalendarService } from '../../calendar/school-calendar.service';
import { resolveTenantSettings } from '../../schools/settings/tenant-settings-resolver';
import { DuplicateStrategy, FeeGenerationSource, FineTrigger, PeriodType } from '@biddaloy/shared';
import { FINE_TRIGGERS } from './triggers/fine-trigger';
import {
  FineSweepDuplicateDto,
  FineSweepGenerateResultDto,
  FineSweepPreviewResultDto,
  FineSweepRowDto,
} from './dto/fine-sweep.dto';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** All calendar dates in `[from, to]` (inclusive), `'YYYY-MM-DD'`. Matches
 * `SchoolCalendarService`'s own "never use local-timezone `Date` math"
 * convention. */
function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let cursor = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  while (cursor <= end) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 24 * 60 * 60 * 1000;
  }
  return dates;
}

function lastDayOfMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  // Day 0 of next month === last day of this month (UTC).
  const d = new Date(Date.UTC(year, mon, 0));
  return d.toISOString().slice(0, 10);
}

function buildNote(trigger: FineTrigger, count: number, freePerPeriod: number): string {
  // i18n: server-side note, family sees it verbatim
  const free = freePerPeriod > 0 ? ` (${freePerPeriod} free)` : '';
  if (trigger === FineTrigger.ATTENDANCE_ABSENT) {
    return `${count} absent day${count === 1 ? '' : 's'}${free}`;
  }
  return `${count} late arrival${count === 1 ? '' : 's'}${free}`;
}

interface Scope {
  classId?: string;
  sectionId?: string;
}

/** Mirrors `FeeGenerationService`'s own `RequestLike` — the approval-token
 * lookup only needs `headers`/`currentTenant`/`user`, not the rest of
 * Express's `Request`. The daily scheduler (no real HTTP request) passes
 * `{ headers: {} }`, same as `fees-daily.scheduler.ts` does today. */
interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  currentTenant?: { id: string };
  user?: { sub: string };
}

interface MatchedFine {
  studentId: string;
  count: number;
  rule: FineRule;
}

/**
 * [38.2.3] Computes attendance-fine bills from active `FineRule`s for one
 * tenant/month, previews them against existing bills, and writes them
 * through `FeeGenerationService.generate()`. `runDue` is the daily
 * scheduler's entry point.
 */
@Injectable()
export class FineSweepService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(FineRule) private readonly fineRuleRepo: Repository<FineRule>,
    @InjectRepository(FeeStructure) private readonly feeStructureRepo: Repository<FeeStructure>,
    @InjectRepository(AcademicYear) private readonly academicYearRepo: Repository<AcademicYear>,
    @InjectRepository(StudentFee) private readonly studentFeeRepo: Repository<StudentFee>,
    @InjectRepository(School) private readonly schoolRepo: Repository<School>,
    private readonly feeGenerationService: FeeGenerationService,
    private readonly schoolCalendarService: SchoolCalendarService,
  ) {}

  /** Resolves the academic year containing `month`, loads active rules for
   * it, evaluates each trigger's occurrences, and turns each matched
   * (student, rule) pair into a fine row. Never writes anything. */
  async compute(tenantId: string, month: string, scope: Scope): Promise<FineSweepRowDto[]> {
    const periodStart = `${month}-01`;
    const periodEnd = lastDayOfMonth(month);

    // A date-range containment filter across two columns can't be expressed
    // with typeorm's `where` shorthand — a query builder does the actual
    // containment check.
    const containingYear = await this.academicYearRepo
      .createQueryBuilder('ay')
      .where('ay.tenant_id = :tenantId', { tenantId })
      .andWhere('ay.deleted_at IS NULL')
      .andWhere('ay.start_date <= :periodStart', { periodStart })
      .andWhere('ay.end_date >= :periodStart', { periodStart })
      .getOne();
    if (!containingYear) {
      throw new NotFoundException(`No academic year covers "${month}" for this tenant`);
    }

    const rules = await this.fineRuleRepo.find({
      where: {
        tenant_id: tenantId,
        academic_year_id: containingYear.id,
        is_active: true,
        deleted_at: IsNull(),
      },
    });
    if (rules.length === 0) return [];

    const { dates: workingDates } = await this.schoolCalendarService.getWorkingDays({
      tenantId,
      from: periodStart,
      to: periodEnd,
    });
    const workingSet = new Set(workingDates);
    const nonWorkingDates = enumerateDates(periodStart, periodEnd).filter(
      (d) => !workingSet.has(d),
    );

    const rulesByTrigger = new Map<FineTrigger, FineRule[]>();
    for (const rule of rules) {
      const list = rulesByTrigger.get(rule.trigger) ?? [];
      list.push(rule);
      rulesByTrigger.set(rule.trigger, list);
    }

    const manager = this.dataSource.manager;
    const matches: MatchedFine[] = [];

    for (const [trigger, triggerRules] of rulesByTrigger) {
      const evaluator = FINE_TRIGGERS[trigger];
      if (!evaluator) {
        throw new NotFoundException(`No trigger evaluator registered for "${trigger}"`);
      }
      const defaultRule = triggerRules.find((r) => r.class_id === null);
      const classRules = triggerRules.filter((r) => r.class_id !== null);
      // Student -> matched rule, class rule wins over default (D22),
      // decided by the student's ACTUAL class (from the evaluator's own
      // row, e.g. the class on their latest occurrence — D21), never by
      // which SQL call happened to include them.
      const byStudent = new Map<string, MatchedFine>();

      // Every evaluator call is scoped only by the request's scope.classId/
      // sectionId — never by a rule's own class_id — because a class rule
      // can carry different `conditions` (e.g. LATE's min_minutes_late) and
      // must still see students whose actual class matches it.
      let defaultCounts = new Map<string, { count: number; classId: string }>();
      if (defaultRule) {
        defaultCounts = await evaluator.count(
          manager,
          tenantId,
          periodStart,
          periodEnd,
          defaultRule.conditions,
          { classId: scope.classId, sectionId: scope.sectionId },
          nonWorkingDates,
        );
      }

      const classCountsByRuleId = new Map<
        string,
        Map<string, { count: number; classId: string }>
      >();
      for (const classRule of classRules) {
        const counted = await evaluator.count(
          manager,
          tenantId,
          periodStart,
          periodEnd,
          classRule.conditions,
          { classId: scope.classId, sectionId: scope.sectionId },
          nonWorkingDates,
        );
        classCountsByRuleId.set(classRule.id, counted);
      }

      const classRuleByClassId = new Map<string, FineRule>();
      for (const classRule of classRules) {
        if (classRule.class_id) classRuleByClassId.set(classRule.class_id, classRule);
      }

      const allStudentIds = new Set<string>(defaultCounts.keys());
      for (const counted of classCountsByRuleId.values()) {
        for (const studentId of counted.keys()) allStudentIds.add(studentId);
      }

      for (const studentId of allStudentIds) {
        const defaultHit = defaultCounts.get(studentId);
        // The student's actual class — from whichever evaluator call saw
        // them, they all report the same real class_id for that student.
        let actualClassId = defaultHit?.classId;
        if (!actualClassId) {
          for (const counted of classCountsByRuleId.values()) {
            const hit = counted.get(studentId);
            if (hit) {
              actualClassId = hit.classId;
              break;
            }
          }
        }
        const matchedClassRule = actualClassId ? classRuleByClassId.get(actualClassId) : undefined;
        if (matchedClassRule) {
          // Class rule wins outright — even if its own conditions exclude
          // this student (no hit here), the default does NOT apply.
          const hit = classCountsByRuleId.get(matchedClassRule.id)?.get(studentId);
          if (hit) {
            byStudent.set(studentId, { studentId, count: hit.count, rule: matchedClassRule });
          }
        } else if (defaultHit) {
          byStudent.set(studentId, { studentId, count: defaultHit.count, rule: defaultRule! });
        }
      }

      matches.push(...byStudent.values());
    }

    if (matches.length === 0) return [];

    const structureIds = [...new Set(matches.map((m) => m.rule.fee_structure_id))];
    const structures = await this.feeStructureRepo.find({
      where: { id: In(structureIds), tenant_id: tenantId },
    });
    const structureById = new Map(structures.map((s) => [s.id, s]));

    const rows: FineSweepRowDto[] = [];
    for (const match of matches) {
      const { rule, count, studentId } = match;
      const billable = Math.max(0, count - rule.free_per_period);
      if (billable <= 0) continue;
      const structure = structureById.get(rule.fee_structure_id);
      if (!structure) continue;
      let amount = round2(billable * Number(structure.amount));
      if (rule.cap_per_period != null) {
        amount = round2(Math.min(amount, Number(rule.cap_per_period)));
      }
      if (amount <= 0) continue;
      rows.push({
        student_id: studentId,
        rule_id: rule.id,
        fee_structure_id: rule.fee_structure_id,
        count,
        amount,
        note: buildNote(rule.trigger, count, rule.free_per_period),
      });
    }
    return rows;
  }

  /** Read-only: `compute()` plus which of those (student, fee structure)
   * pairs already have a bill for this period. */
  async preview(tenantId: string, month: string, scope: Scope): Promise<FineSweepPreviewResultDto> {
    const rows = await this.compute(tenantId, month, scope);
    if (rows.length === 0) {
      return { students: [], total_amount: 0, would_create: 0, duplicates: [] };
    }

    const periodStart = new Date(`${month}-01T00:00:00.000Z`);
    const studentIds = [...new Set(rows.map((r) => r.student_id))];
    const structureIds = [...new Set(rows.map((r) => r.fee_structure_id))];
    const existing = await this.studentFeeRepo.find({
      where: {
        student_id: In(studentIds),
        fee_structure_id: In(structureIds),
        period_start: periodStart,
      },
    });
    const duplicates: FineSweepDuplicateDto[] = existing.map((bill) => ({
      student_id: bill.student_id,
      fee_structure_id: bill.fee_structure_id,
      existing_bill_id: bill.id,
      paid_amount: Number(bill.paid_amount),
    }));
    const duplicateKeys = new Set(duplicates.map((d) => `${d.student_id}:${d.fee_structure_id}`));
    // generate() merges rows sharing (student_id, fee_structure_id) into one bill — dedupe by
    // the same key here, or a student hit by two rules on the same structure inflates the count.
    const wouldCreateKeys = new Set(
      rows
        .filter((r) => !duplicateKeys.has(`${r.student_id}:${r.fee_structure_id}`))
        .map((r) => `${r.student_id}:${r.fee_structure_id}`),
    );
    const wouldCreate = wouldCreateKeys.size;
    const totalAmount = round2(rows.reduce((sum, r) => sum + r.amount, 0));

    return { students: rows, total_amount: totalAmount, would_create: wouldCreate, duplicates };
  }

  /** Writes the computed fines through `FeeGenerationService.generate()`,
   * grouped by `fee_structure_id` (one `generate()` call per group, each
   * with a `billOverrides` map carrying the per-student amount/note/rule).
   * Never updates an existing bill (D7) — `duplicate_strategy` is passed
   * straight through to `generate()`, which owns REMOVE_OLDER/CREATE_ANYWAY
   * approval-gating exactly as a manual `POST /fees/generate` would. */
  async generate(
    tenantId: string,
    userId: string | null,
    month: string,
    scope: Scope,
    duplicateStrategy: DuplicateStrategy = DuplicateStrategy.SKIP,
    notify?: boolean,
    request: RequestLike = { headers: {} },
    today: string = new Date().toISOString().slice(0, 10),
  ): Promise<FineSweepGenerateResultDto> {
    const rows = await this.compute(tenantId, month, scope);
    const result: FineSweepGenerateResultDto = {
      fee_generation_ids: [],
      generated_count: 0,
      skipped_count: 0,
    };
    if (rows.length === 0) return result;

    const containingYear = await this.academicYearRepo
      .createQueryBuilder('ay')
      .where('ay.tenant_id = :tenantId', { tenantId })
      .andWhere('ay.deleted_at IS NULL')
      .andWhere('ay.start_date <= :periodStart', { periodStart: `${month}-01` })
      .andWhere('ay.end_date >= :periodStart', { periodStart: `${month}-01` })
      .getOne();
    if (!containingYear) {
      throw new NotFoundException(`No academic year covers "${month}" for this tenant`);
    }

    const school = await this.schoolRepo.findOne({ where: { id: tenantId } });
    const settings = resolveTenantSettings(
      (school?.settings as Record<string, unknown> | null) ?? null,
    );
    const fineDueDays = settings.fees?.fineDueDays ?? 7;
    const dueDate = addDaysIso(today, fineDueDays);

    const rowsByStructure = new Map<string, FineSweepRowDto[]>();
    for (const row of rows) {
      const list = rowsByStructure.get(row.fee_structure_id) ?? [];
      list.push(row);
      rowsByStructure.set(row.fee_structure_id, list);
    }

    for (const [structureId, structureRows] of rowsByStructure) {
      const billOverrides = new Map<
        string,
        { amount: number; note?: string | null; fine_rule_id?: string | null }
      >();
      const studentIds: string[] = [];
      // Two rules (e.g. ABSENT + LATE) can point at the same fee_structure —
      // merge rather than overwrite, or one fine silently disappears while
      // `preview().total_amount` still counted both (D-none, bug fix).
      for (const row of structureRows) {
        const key = `${row.student_id}:${structureId}`;
        const existing = billOverrides.get(key);
        if (existing) {
          existing.amount = round2(existing.amount + row.amount);
          existing.note = existing.note ? `${existing.note}; ${row.note}` : row.note;
        } else {
          studentIds.push(row.student_id);
          billOverrides.set(key, {
            amount: row.amount,
            note: row.note,
            fine_rule_id: row.rule_id,
          });
        }
      }

      const generated = await this.feeGenerationService.generate(
        {
          academic_year_id: containingYear.id,
          period_start: `${month}-01`,
          period_type: PeriodType.MONTH,
          student_ids: studentIds,
          fee_structure_ids: [structureId],
          include_inactive: false,
          due_date: dueDate,
          duplicate_strategy: duplicateStrategy,
          notify_families: notify,
        },
        tenantId,
        userId,
        request,
        {
          source: FeeGenerationSource.FINE_RULE,
          billOverrides,
        },
      );
      result.fee_generation_ids.push(generated.fee_generation_id);
      result.generated_count += generated.generated_count;
      result.skipped_count += generated.skipped_count;
    }

    return result;
  }

  /** Daily scheduler entry point (38.2.5's caller). Runs `generate()` for
   * the previous month, once the correction window has closed — the family
   * gets `correctionWindowDays` days after month-end to fix a wrong
   * attendance mark before it's billed (D26). */
  async runDue(tenantId: string, today: string): Promise<void> {
    const school = await this.schoolRepo.findOne({ where: { id: tenantId } });
    const settings = resolveTenantSettings(
      (school?.settings as Record<string, unknown> | null) ?? null,
    );
    const correctionWindowDays = settings.attendance?.correctionWindowDays ?? 2;

    const day = Number(today.slice(8, 10));
    if (day < correctionWindowDays + 1) return;

    const [year, month] = today.slice(0, 7).split('-').map(Number);
    // Previous month, wrapping year boundary — 'YYYY-MM'.
    const prevMonthDate = new Date(Date.UTC(year, month - 2, 1));
    const previousMonth = `${prevMonthDate.getUTCFullYear()}-${String(
      prevMonthDate.getUTCMonth() + 1,
    ).padStart(2, '0')}`;

    try {
      await this.generate(
        tenantId,
        null,
        previousMonth,
        {},
        DuplicateStrategy.SKIP,
        true,
        { headers: {} },
        today,
      );
    } catch (err) {
      // No academic year covering last month shouldn't break the daily
      // sweep loop for every OTHER tenant — skip this one silently.
      if (err instanceof NotFoundException) return;
      throw err;
    }
  }
}

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
