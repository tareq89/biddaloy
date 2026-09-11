import type { EntityManager } from 'typeorm';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { classesTab } from './classes.tab';

/**
 * The `sections` tab: divisions within a class (e.g. "Section A").
 *
 * Sheet name is `sections`; the ticket calls the entity "sections" even
 * though the table itself is `class_sections`. Two `ref` columns: `class`
 * resolves against the `classes` tab (whose own natural key already embeds
 * its academic year), and `academic_year` resolves against `academic_years`
 * directly — carried on the row for readability and so a section's year is
 * checkable without cross-referencing the `classes` sheet.
 *
 * `capacity` is entity-nullable and kept per the ticket's column list
 * (dropped only if the entity had none — it does have one).
 */

export interface ClassSectionRow {
  id: string;
  class_id: string;
  academic_year_id: string;
  section_name: string;
  capacity: number | null;
  // The referenced tabs' own natural keys, kept alongside the resolved
  // local ids so `keyOf` can build the same key format for a row as for an
  // entity, without a uuid ever appearing in a natural key.
  class_key: string;
  academic_year_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'class',
    type: 'ref',
    ref: 'classes',
    required: true,
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
    key: 'section_name',
    type: 'string',
    required: true,
    label: { en: 'Section name', bn: 'শাখার নাম' },
  },
  { key: 'capacity', type: 'int', label: { en: 'Capacity', bn: 'ধারণক্ষমতা' } },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `ClassSection`
 * column appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'class_id', // exported instead as the `class` ref column, keyed by the referenced tab's natural key
];

const MAX_LENGTHS: Record<string, number> = {
  section_name: 20,
};

export const sectionsTab: TabSpec<ClassSection, ClassSectionRow> = {
  name: 'sections',
  entity: ClassSection,
  excluded,
  dependsOn: ['classes', 'academic_years'],
  columns,
  naturalKey: ['class', 'academic_year', 'section_name'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<ClassSection[]> {
    // `class` (and its own `academic_year`) are loaded eagerly: `toRow` needs
    // the parent class's `academic_year_id` to export the `academic_year` ref
    // column, and `keyOf` needs both the class's and the year's natural-key
    // text (never a uuid) to build a key that matches a freshly-imported row.
    return m.find(ClassSection, {
      where: { tenant_id: tenantId },
      relations: ['class', 'class.academic_year'],
    });
  },

  toRow(entity: ClassSection, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      class: ctx.keyOf('classes', entity.class_id),
      // `class`'s own natural key is `name|academic_year_id`; splitting it
      // back out here would be fragile, so the year is exported straight
      // from the section's own class relation via a second, independent
      // ref lookup instead of parsing the class key.
      academic_year: ctx.keyOf('academic_years', entity.class?.academic_year_id ?? ''),
      section_name: entity.section_name,
      capacity: entity.capacity,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: ClassSectionRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'sections', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'sections',
          row: rowNo,
          column: column.key,
          message: `Column "${column.key}": is longer than the ${limit} characters allowed.`,
          severity: 'error',
          value: raw,
        });
        continue;
      }

      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    let classId: string | undefined;
    const classKey = values.class as string;
    if (classKey) {
      classId = ctx.ref('classes', classKey);
      if (!classId) {
        errors.push({
          tab: 'sections',
          row: rowNo,
          column: 'class',
          message: `Column "class": no class named "${classKey}" was found.`,
          severity: 'error',
          value: classKey,
        });
      }
    }

    let academicYearId: string | undefined;
    const academicYearKey = values.academic_year as string;
    if (academicYearKey) {
      academicYearId = ctx.ref('academic_years', academicYearKey);
      if (!academicYearId) {
        errors.push({
          tab: 'sections',
          row: rowNo,
          column: 'academic_year',
          message: `Column "academic_year": no academic year named "${academicYearKey}" was found.`,
          severity: 'error',
          value: academicYearKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    // `classKey` embeds its own academic year (`classesTab.keyOf` builds it
    // as `${name}|${yearKey}`) — reject a row whose separately given
    // `academic_year` names a different year, since persistence only saves
    // `class_id` and would otherwise silently ignore the contradiction.
    const classYearKey = classKey.slice(classKey.indexOf('|') + 1);
    if (classYearKey !== academicYearKey) {
      return {
        errors: [
          {
            tab: 'sections',
            row: rowNo,
            column: 'academic_year',
            message: `Column "academic_year": "${academicYearKey}" does not match the academic year of class "${classKey}".`,
            severity: 'error',
            value: academicYearKey,
          },
        ],
      };
    }

    return {
      row: {
        id: values.id as string,
        class_id: classId as string,
        academic_year_id: academicYearId as string,
        section_name: values.section_name as string,
        capacity: (values.capacity as number | null) ?? null,
        class_key: classKey,
        academic_year_key: academicYearKey,
      },
    };
  },

  keyOf(x: ClassSectionRow | ClassSection): string {
    // A natural key is never a uuid (see key-index.ts): a row carries the
    // referenced tabs' key text directly, an entity must derive it from the
    // (eagerly loaded) `class` (and its own `academic_year`) relation.
    const classKey =
      x instanceof ClassSection ? (x.class ? classesTab.keyOf(x.class) : '') : x.class_key;
    const yearKey =
      x instanceof ClassSection ? (x.class?.academic_year?.name ?? '') : x.academic_year_key;
    return `${classKey}|${yearKey}|${x.section_name}`;
  },

  diffFields(row: ClassSectionRow, existing: ClassSection): string[] {
    const changed: string[] = [];
    if (row.class_id !== existing.class_id) changed.push('class');
    if (row.section_name !== existing.section_name) changed.push('section_name');
    if (row.capacity !== existing.capacity) changed.push('capacity');
    return changed;
  },

  async upsert(
    row: ClassSectionRow,
    existing: ClassSection | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<ClassSection> {
    const section = existing ?? new ClassSection();
    section.tenant_id = tenantId;
    section.class_id = row.class_id;
    section.section_name = row.section_name;
    section.capacity = row.capacity;

    return m.save(ClassSection, section);
  },

  async remove(entity: ClassSection, m: EntityManager): Promise<void> {
    await m.softRemove(ClassSection, entity);
  },
};
