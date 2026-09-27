import type { EntityManager } from 'typeorm';
import { ProgramMilestone } from '../../../programs/entities/program-milestone.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { programsTab } from './programs.tab';

/**
 * The `program_milestones` tab (Epic 34.0, [34.1.4]): one row per ordered
 * milestone within a `Program` (D15). Natural key is `program|sequence`,
 * matching the entity's own deferrable `(program_id, sequence)` unique
 * constraint.
 */
export interface ProgramMilestoneRow {
  id: string;
  program_id: string;
  name: string;
  description: string | null;
  sequence: number;
  program_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'program',
    type: 'ref',
    ref: 'programs',
    required: true,
    label: { en: 'Program', bn: 'প্রোগ্রাম' },
  },
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  { key: 'description', type: 'string', label: { en: 'Description', bn: 'বিবরণ' } },
  { key: 'sequence', type: 'int', required: true, label: { en: 'Sequence', bn: 'ক্রম' } },
];

const excluded: readonly string[] = [
  'program_id', // exported instead as the `program` ref column, keyed by the program's name
];

export const programMilestonesTab: TabSpec<ProgramMilestone, ProgramMilestoneRow> = {
  name: 'program_milestones',
  entity: ProgramMilestone,
  excluded,
  dependsOn: ['programs'],
  columns,
  naturalKey: ['program', 'sequence'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<ProgramMilestone[]> {
    return m.find(ProgramMilestone, {
      where: { tenant_id: tenantId },
      relations: ['program'],
    });
  },

  toRow(entity: ProgramMilestone, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      program: ctx.keyOf('programs', entity.program_id),
      name: entity.name,
      description: entity.description,
      sequence: entity.sequence,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: ProgramMilestoneRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'program_milestones', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const programKey = values.program as string;
    const programId = ctx.ref('programs', programKey);
    if (!programId) {
      errors.push({
        tab: 'program_milestones',
        row: rowNo,
        column: 'program',
        message: `Column "program": no program named "${programKey}" was found.`,
        severity: 'error',
        value: programKey,
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        program_id: programId as string,
        name: values.name as string,
        description: (values.description as string | null) ?? null,
        sequence: values.sequence as number,
        program_key: programKey,
      },
    };
  },

  keyOf(x: ProgramMilestoneRow | ProgramMilestone): string {
    const programKey =
      x instanceof ProgramMilestone
        ? x.program
          ? programsTab.keyOf(x.program)
          : ''
        : x.program_key;
    return `${programKey}|${x.sequence}`;
  },

  diffFields(row: ProgramMilestoneRow, existing: ProgramMilestone): string[] {
    const changed: string[] = [];
    if (row.name !== existing.name) changed.push('name');
    if (row.description !== existing.description) changed.push('description');
    return changed;
  },

  async upsert(
    row: ProgramMilestoneRow,
    existing: ProgramMilestone | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<ProgramMilestone> {
    const milestone = existing ?? new ProgramMilestone();
    milestone.tenant_id = tenantId;
    milestone.program_id = row.program_id;
    milestone.name = row.name;
    milestone.description = row.description;
    milestone.sequence = row.sequence;
    return m.save(ProgramMilestone, milestone);
  },

  async remove(entity: ProgramMilestone, m: EntityManager): Promise<void> {
    await m.remove(ProgramMilestone, entity);
  },
};
