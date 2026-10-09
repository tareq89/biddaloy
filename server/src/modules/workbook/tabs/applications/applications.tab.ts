import type { EntityManager } from 'typeorm';
import {
  ApplicationAddressee,
  ApplicationSource,
  ApplicationStatus,
  ApplicationType,
} from '@biddaloy/shared';
import { Application } from '../../../applications/entities/application.entity';
import { fromCell, toCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `applications` tab (52.1.6): one application of any type. Natural key
 * `(serial_year, serial_no)`, unique per school (D29).
 *
 * Every user/student/staff/year reference is nullable here (D46: a paper
 * application can have no login-holding applicant), so this is hand-written
 * rather than built with `createRefChildTab`, whose refs are all required.
 * The two DB CHECKs (one subject; applicant-or-paper-name) are re-checked in
 * `fromRow` so one bad row is reported instead of failing the whole import.
 */
type Rec = Record<string, unknown>;

/** Nullable ref columns: [column key = entity relation, entity FK property, referenced tab, label en, label bn]. */
const REFS = [
  ['academic_year', 'academic_year_id', 'academic_years', 'Academic year', 'শিক্ষাবর্ষ'],
  ['applicant', 'applicant_user_id', 'users', 'Applicant', 'আবেদনকারী'],
  ['entered_by', 'entered_by_user_id', 'users', 'Entered by', 'এন্ট্রিকারী'],
  ['addressee_user', 'addressee_user_id', 'users', 'Addressee user', 'প্রাপক ব্যবহারকারী'],
  ['decided_by', 'decided_by_user_id', 'users', 'Decided by', 'সিদ্ধান্তদাতা'],
  ['subject_student', 'subject_student_id', 'students', 'Student', 'শিক্ষার্থী'],
  ['subject_staff_profile', 'subject_staff_profile_id', 'staff_profiles', 'Staff', 'কর্মচারী'],
] as const;

const SCALARS: readonly ColumnSpec[] = [
  {
    key: 'serial_year',
    type: 'int',
    required: true,
    label: { en: 'Serial year', bn: 'সিরিয়াল বছর' },
  },
  { key: 'serial_no', type: 'int', required: true, label: { en: 'Serial no', bn: 'সিরিয়াল নং' } },
  {
    key: 'type',
    type: 'enum',
    required: true,
    enumValues: Object.values(ApplicationType),
    label: { en: 'Type', bn: 'ধরন' },
  },
  {
    key: 'status',
    type: 'enum',
    required: true,
    enumValues: Object.values(ApplicationStatus),
    label: { en: 'Status', bn: 'অবস্থা' },
  },
  {
    key: 'source',
    type: 'enum',
    required: true,
    enumValues: Object.values(ApplicationSource),
    label: { en: 'Source', bn: 'উৎস' },
  },
  {
    key: 'addressee',
    type: 'enum',
    enumValues: Object.values(ApplicationAddressee),
    label: { en: 'Addressee', bn: 'প্রাপক' },
  },
  { key: 'applicant_name', type: 'string', label: { en: 'Applicant name', bn: 'আবেদনকারীর নাম' } },
  { key: 'payload', type: 'json', required: true, label: { en: 'Payload', bn: 'তথ্য' } },
  { key: 'start_date', type: 'date', label: { en: 'Start date', bn: 'শুরুর তারিখ' } },
  { key: 'end_date', type: 'date', label: { en: 'End date', bn: 'শেষ তারিখ' } },
  {
    key: 'current_step',
    type: 'int',
    required: true,
    label: { en: 'Current step', bn: 'বর্তমান ধাপ' },
  },
  { key: 'letter_text', type: 'string', required: true, label: { en: 'Letter', bn: 'চিঠি' } },
  {
    key: 'letter_locale',
    type: 'string',
    required: true,
    label: { en: 'Letter language', bn: 'চিঠির ভাষা' },
  },
  { key: 'granted', type: 'json', label: { en: 'Granted', bn: 'মঞ্জুর' } },
  { key: 'effect_result', type: 'json', label: { en: 'Effect result', bn: 'ফলাফল' } },
  { key: 'decided_at', type: 'datetime', label: { en: 'Decided at', bn: 'সিদ্ধান্তের সময়' } },
];

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  ...SCALARS,
  ...REFS.map(([key, , ref, en, bn]) => ({
    key,
    type: 'ref' as const,
    ref,
    label: { en, bn },
  })),
];

const MAX_LENGTHS: Record<string, number> = { applicant_name: 150, letter_locale: 8 };

const excluded: readonly string[] = [
  ...REFS.map(([, fk]) => fk), // exported instead as the matching ref column, keyed by the referenced tab's natural key
  'tenant_id', // implicit: every row is scoped to the workbook's own tenant
];

/** Key-sorted JSON so jsonb's key order never shows as a diff. */
const canon = (v: unknown): string =>
  JSON.stringify(v ?? null, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

const rowError = (
  rowNo: number,
  column: string | null,
  message: string,
  value?: string,
): RowError => ({ tab: 'applications', row: rowNo, column, message, severity: 'error', value });

export const applicationsTab: TabSpec<Application, Rec> = {
  name: 'applications',
  entity: Application,
  excluded,
  dependsOn: ['academic_years', 'users', 'students', 'staff_profiles'],
  columns,
  naturalKey: ['serial_year', 'serial_no'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Application[]> {
    return m.find(Application, { where: { tenant_id: tenantId } });
  },

  toRow(entity: Application, ctx: ExportContext): Rec {
    const e = entity as unknown as Rec;
    const out: Rec = { id: entity.id };
    for (const c of SCALARS) out[c.key] = e[c.key];
    for (const [key, fk, tab] of REFS) out[key] = e[fk] ? ctx.keyOf(tab, e[fk] as string) : null;
    return out;
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: Rec } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Rec = {};
    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'applications', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push(
          rowError(
            rowNo,
            column.key,
            `Column "${column.key}": is longer than the ${limit} characters allowed.`,
            raw,
          ),
        );
        continue;
      }
      values[column.key] = result.value;
    }
    if (errors.length > 0) return { errors };

    const out: Rec = { id: values.id };
    for (const c of SCALARS) out[c.key] = values[c.key] ?? null;
    for (const [key, fk, tab] of REFS) {
      const refKey = (values[key] as string | null) ?? '';
      out[`${key}_key`] = refKey || null;
      out[fk] = null;
      if (!refKey) continue;
      const id = ctx.ref(tab, refKey);
      if (!id) {
        errors.push(
          rowError(
            rowNo,
            key,
            `Column "${key}": no ${tab} row with the key "${refKey}" was found.`,
            refKey,
          ),
        );
      } else {
        out[fk] = id;
      }
    }

    // Same two rules as the DB CHECKs, so a bad row is one error, not a failed import.
    // Skipped when a ref already failed: the missing id would only add a misleading second error.
    if (errors.length > 0) return { errors };
    if (!!out.subject_student_id === !!out.subject_staff_profile_id) {
      errors.push(
        rowError(
          rowNo,
          null,
          'Exactly one of "subject_student" and "subject_staff_profile" must be filled.',
        ),
      );
    }
    if (!out.applicant_user_id && !(out.source === ApplicationSource.PAPER && out.applicant_name)) {
      errors.push(
        rowError(
          rowNo,
          'applicant',
          'An application needs an "applicant", unless its source is PAPER and "applicant_name" is filled.',
        ),
      );
    }
    if (errors.length > 0) return { errors };
    return { row: out };
  },

  keyOf(x: Rec | Application): string {
    return `${x.serial_year}|${x.serial_no}`;
  },

  diffFields(row: Rec, existing: Application): string[] {
    const e = existing as unknown as Rec;
    const changed: string[] = [];
    for (const c of SCALARS) {
      const a = row[c.key] ?? null;
      const b = e[c.key] ?? null;
      const same =
        c.type === 'json'
          ? canon(a) === canon(b)
          : c.type === 'date' || c.type === 'datetime'
            ? toCell(c.type, a) === toCell(c.type, b)
            : a === b;
      if (!same) changed.push(c.key);
    }
    for (const [key, fk] of REFS) if ((row[fk] ?? null) !== (e[fk] ?? null)) changed.push(key);
    return changed;
  },

  async upsert(
    row: Rec,
    existing: Application | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Application> {
    // Tenant-scoped re-lookup: never match another school's serial.
    const app =
      existing ??
      (await m.findOne(Application, {
        where: {
          tenant_id: tenantId,
          serial_year: row.serial_year as number,
          serial_no: row.serial_no as number,
        },
      })) ??
      new Application();
    const a = app as unknown as Rec;
    a.tenant_id = tenantId;
    for (const c of SCALARS) {
      const v = row[c.key] ?? null;
      a[c.key] = c.type === 'datetime' && v !== null ? new Date(v as string) : v;
    }
    for (const [key, fk] of REFS) {
      a[fk] = row[fk] ?? null;
      a[key] = undefined; // the FK column wins over any loaded relation
    }
    return m.save(Application, app);
  },

  async remove(entity: Application, m: EntityManager): Promise<void> {
    await m.remove(Application, entity);
  },
};
