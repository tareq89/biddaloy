import type { EntityManager } from 'typeorm';
import { FineRule } from '../../../fees/entities/fine-rule.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { FineTrigger } from '@biddaloy/shared';
import { classesTab } from '../academics/classes.tab';
import { academicYearsTab } from '../academics/academic-years.tab';

/**
 * The `fine_rules` tab: a school's standing fine policy per `FineTrigger`
 * (D6, D22 — see `fine-rule.entity.ts`).
 *
 * `class`, `academic_year` and `fee_structure` are `ref` columns, the same
 * pattern as `fee-structures.tab.ts`; `class` is optional (a school-wide
 * default rule), the other two are required.
 */

export interface FineRuleRow {
  id: string;
  trigger: FineTrigger;
  fee_structure_id: string;
  fee_structure_key: string;
  class_id: string | null;
  class_key: string | null;
  academic_year_id: string;
  academic_year_key: string;
  free_per_period: number;
  cap_per_period: string | null;
  conditions: unknown;
  is_active: boolean;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'trigger',
    type: 'enum',
    required: true,
    enumValues: Object.values(FineTrigger),
    label: { en: 'Trigger', bn: 'ট্রিগার' },
  },
  {
    key: 'fee_structure',
    type: 'ref',
    ref: 'fee_structures',
    required: true,
    label: { en: 'Fee structure', bn: 'ফি কাঠামো' },
  },
  {
    key: 'class',
    type: 'ref',
    ref: 'classes',
    label: { en: 'Class', bn: 'শ্রেণী' },
  },
  {
    key: 'academic_year',
    type: 'ref',
    ref: 'academic_years',
    required: true,
    label: { en: 'Academic year', bn: 'শিক্ষাবর্ষ' },
  },
  {
    key: 'free_per_period',
    type: 'int',
    required: true,
    label: { en: 'Free per period', bn: 'মুক্ত সংখ্যা' },
  },
  {
    key: 'cap_per_period',
    type: 'money',
    label: { en: 'Cap per period', bn: 'সর্বোচ্চ সীমা' },
  },
  {
    key: 'conditions',
    type: 'json',
    required: true,
    label: { en: 'Conditions', bn: 'শর্তাবলী' },
  },
  {
    key: 'is_active',
    type: 'bool',
    required: true,
    label: { en: 'Active', bn: 'সক্রিয়' },
  },
];

const excluded: readonly string[] = [
  'fee_structure_id', // exported instead as the `fee_structure` ref column
  'class_id', // exported instead as the `class` ref column
  'academic_year_id', // exported instead as the `academic_year` ref column
  // No workbook editing flow for who created a rule; a restore leaves it
  // null rather than fabricating provenance (same call as `student-fees.tab.ts`).
  'created_by_user_id',
];

export const fineRulesTab: TabSpec<FineRule, FineRuleRow> = {
  name: 'fine_rules',
  entity: FineRule,
  excluded,
  dependsOn: ['classes', 'academic_years', 'fee_structures'],
  columns,
  // is_active is part of the key: the DB unique index only covers active rows,
  // so an active and an inactive rule may share year/trigger/class.
  naturalKey: ['academic_year', 'trigger', 'class', 'is_active'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<FineRule[]> {
    return m.find(FineRule, {
      where: { tenant_id: tenantId },
      relations: [
        'class',
        'class.academic_year',
        'academic_year',
        'fee_structure',
        'fee_structure.class',
        'fee_structure.class.academic_year',
        'fee_structure.academic_year',
        'fee_structure.section',
      ],
    });
  },

  toRow(entity: FineRule, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      trigger: entity.trigger,
      fee_structure: ctx.keyOf('fee_structures', entity.fee_structure_id),
      class: entity.class_id ? ctx.keyOf('classes', entity.class_id) : null,
      academic_year: ctx.keyOf('academic_years', entity.academic_year_id),
      free_per_period: entity.free_per_period,
      cap_per_period: entity.cap_per_period,
      conditions: entity.conditions,
      is_active: entity.is_active,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: FineRuleRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'fine_rules', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    let feeStructureId: string | undefined;
    const feeStructureKey = values.fee_structure as string;
    if (feeStructureKey) {
      feeStructureId = ctx.ref('fee_structures', feeStructureKey);
      if (!feeStructureId) {
        errors.push({
          tab: 'fine_rules',
          row: rowNo,
          column: 'fee_structure',
          message: `Column "fee_structure": no fee structure "${feeStructureKey}" was found.`,
          severity: 'error',
          value: feeStructureKey,
        });
      }
    }

    let classId: string | null = null;
    const classKey = (values.class as string | null) ?? null;
    if (classKey) {
      const resolved = ctx.ref('classes', classKey);
      if (!resolved) {
        errors.push({
          tab: 'fine_rules',
          row: rowNo,
          column: 'class',
          message: `Column "class": no class named "${classKey}" was found.`,
          severity: 'error',
          value: classKey,
        });
      } else {
        classId = resolved;
      }
    }

    let academicYearId: string | undefined;
    const academicYearKey = values.academic_year as string;
    if (academicYearKey) {
      academicYearId = ctx.ref('academic_years', academicYearKey);
      if (!academicYearId) {
        errors.push({
          tab: 'fine_rules',
          row: rowNo,
          column: 'academic_year',
          message: `Column "academic_year": no academic year named "${academicYearKey}" was found.`,
          severity: 'error',
          value: academicYearKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        trigger: values.trigger as FineTrigger,
        fee_structure_id: feeStructureId as string,
        fee_structure_key: feeStructureKey,
        class_id: classId,
        class_key: classKey || null,
        academic_year_id: academicYearId as string,
        academic_year_key: academicYearKey,
        free_per_period: values.free_per_period as number,
        cap_per_period: (values.cap_per_period as string | null) ?? null,
        conditions: values.conditions ?? {},
        is_active: values.is_active as boolean,
      },
    };
  },

  keyOf(x: FineRuleRow | FineRule): string {
    const yearKey =
      x instanceof FineRule
        ? x.academic_year
          ? academicYearsTab.keyOf(x.academic_year)
          : ''
        : x.academic_year_key;
    const classKey =
      x instanceof FineRule ? (x.class ? classesTab.keyOf(x.class) : '') : (x.class_key ?? '');
    return `${yearKey}|${x.trigger}|${classKey}`;
  },

  diffFields(row: FineRuleRow, existing: FineRule): string[] {
    const changed: string[] = [];
    if (row.trigger !== existing.trigger) changed.push('trigger');
    if (row.fee_structure_id !== existing.fee_structure_id) changed.push('fee_structure');
    if (row.class_id !== existing.class_id) changed.push('class');
    if (row.academic_year_id !== existing.academic_year_id) changed.push('academic_year');
    if (row.free_per_period !== existing.free_per_period) changed.push('free_per_period');
    if (String(row.cap_per_period) !== String(existing.cap_per_period)) {
      changed.push('cap_per_period');
    }
    if (JSON.stringify(row.conditions) !== JSON.stringify(existing.conditions)) {
      changed.push('conditions');
    }
    if (row.is_active !== existing.is_active) changed.push('is_active');
    return changed;
  },

  async upsert(
    row: FineRuleRow,
    existing: FineRule | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<FineRule> {
    const rule = existing ?? new FineRule();
    rule.tenant_id = tenantId;
    rule.trigger = row.trigger;
    rule.fee_structure_id = row.fee_structure_id;
    rule.class_id = row.class_id;
    rule.academic_year_id = row.academic_year_id;
    rule.free_per_period = row.free_per_period;
    rule.cap_per_period = row.cap_per_period as unknown as number | null;
    rule.conditions = (row.conditions ?? {}) as Record<string, string | number | boolean | null>;
    rule.is_active = row.is_active;

    return await m.save(FineRule, rule);
  },

  async remove(entity: FineRule, m: EntityManager): Promise<void> {
    await m.softRemove(FineRule, entity);
  },
};
