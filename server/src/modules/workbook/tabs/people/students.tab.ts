import type { EntityManager } from 'typeorm';
import { CommunicationMedium, EnrollmentStatus } from '@biddaloy/shared';
import { Student } from '../../../students/entities/student.entity';
import { Guardian } from '../../../students/entities/guardian.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `students` tab: every enrolled student, plus which guardians they are
 * linked to.
 *
 * `entity: Student`, table `students`. `class` and `academic_year` are
 * **not** columns on the entity — they are derived from
 * `class_section.class_id` and `class_section.class.academic_year_id`
 * (same pattern `teacher-assignments.tab.ts` uses), so `load` must eagerly
 * join `class_section`, `class_section.class`, `class_section.class.academic_year`.
 * They are resolved for validation only and never cross-checked against
 * `section` — the section key already embeds pipe-joined class/year
 * fragments, so a textual cross-check would be fragile.
 *
 * `guardian_phones` is a misnamed column: despite the name, a cell entry is
 * whatever `guardiansTab.keyOf` produced for that guardian — a phone number,
 * or (when phone is absent) an email, or (when both are absent) a
 * `full_name|relationship` pair. The `;` list delimiter never collides with
 * the `|` used inside a fallback guardian key. The column key is kept as-is
 * because it is the contract this ticket specifies.
 *
 * `registration_number` carries a GLOBAL unique constraint in the database
 * (`UQ_82946fdb5652b83cacb81e9083e`), not tenant-scoped despite the entity's
 * `@Index(['tenant_id', 'registration_number'])` decorator — that composite
 * unique index was never migrated (see `upsert` below). Because the key is
 * genuinely globally unique, `keyOf` needs no fallback chain, unlike
 * `guardians`.
 *
 * `Student.guardians` has `cascade: ['insert']` on the entity. Assigning
 * `.guardians` and calling `m.save` risks TypeORM inserting a duplicate
 * `Guardian` row on every restore. `upsert` below never touches
 * `student.guardians` directly — it reconciles the `student_guardians` join
 * table explicitly via `m.relation(Student, 'guardians').of(student).addAndRemove(...)`.
 */
export interface StudentRow {
  id: string;
  registration_number: string;
  full_name: string;
  roll_number: number;
  class_section_id: string;
  date_of_birth: string | null;
  gender: string | null;
  home_address: string | null;
  preferred_communication: CommunicationMedium;
  enrollment_status: EnrollmentStatus;
  guardian_ids: string[];
  user_id: string | null;
  // Referenced tabs' own natural-key text, kept beside the resolved ids so
  // `keyOf` builds the same string for a row as for an entity.
  class_key: string;
  academic_year_key: string;
  section_key: string;
  guardian_keys: string[];
  user_key: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'registration_number',
    type: 'string',
    required: true,
    label: { en: 'Registration number', bn: 'রেজিস্ট্রেশন নম্বর' },
  },
  {
    key: 'full_name',
    type: 'string',
    required: true,
    label: { en: 'Full name', bn: 'পূর্ণ নাম' },
  },
  {
    // The column is NOT NULL on the entity.
    key: 'roll_number',
    type: 'int',
    required: true,
    label: { en: 'Roll number', bn: 'রোল নম্বর' },
  },
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
    key: 'section',
    type: 'ref',
    ref: 'sections',
    required: true,
    label: { en: 'Section', bn: 'শাখা' },
  },
  {
    key: 'date_of_birth',
    type: 'date',
    label: { en: 'Date of birth', bn: 'জন্ম তারিখ' },
  },
  {
    // A plain varchar(10), not an enum: no `Gender` enum exists in `shared/`.
    key: 'gender',
    type: 'string',
    label: { en: 'Gender', bn: 'লিঙ্গ' },
  },
  {
    key: 'home_address',
    type: 'string',
    label: { en: 'Home address', bn: 'বাসার ঠিকানা' },
  },
  {
    // Not `required`: an empty cell defaults to the entity's own default
    // (`SMS`), handled explicitly in `fromRow` below.
    key: 'preferred_communication',
    type: 'enum',
    enumValues: Object.values(CommunicationMedium),
    label: { en: 'Preferred communication', bn: 'পছন্দের যোগাযোগ মাধ্যম' },
  },
  {
    // Not `required`; an empty cell defaults to `ACTIVE`.
    key: 'enrollment_status',
    type: 'enum',
    enumValues: Object.values(EnrollmentStatus),
    label: { en: 'Enrollment status', bn: 'ভর্তির অবস্থা' },
  },
  {
    // Misnamed: carries `guardiansTab.keyOf` output, which may be a phone,
    // an email, or a `full_name|relationship` pair. See the file docblock.
    key: 'guardian_phones',
    type: 'ref-list',
    ref: 'guardians',
    label: { en: 'Guardian phones', bn: 'অভিভাবকের ফোন' },
  },
  {
    // The portal login is optional, so this is not `required`.
    key: 'user',
    type: 'ref',
    ref: 'users',
    label: { en: 'User', bn: 'ব্যবহারকারী' },
  },
];

/**
 * `Student` columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `Student` column
 * appears in neither `columns` nor here.
 *
 * `guardians` gets no entry here: it is a relation (the `@JoinTable` lives
 * on `Student`), not a scalar column, so the completeness gate rejects
 * listing it. `class`/`academic_year` also get no entry — they are not
 * entity columns at all, they are derived (see the file doc comment above).
 */
const excluded: readonly string[] = [
  'user_id', // exported instead as the `user` ref column, keyed by the referenced tab's natural key
  'class_section_id', // exported instead as the `section` ref column, keyed by the referenced tab's natural key
];

const MAX_LENGTHS: Record<string, number> = {
  registration_number: 50,
  full_name: 100,
  gender: 10,
};

export const studentsTab: TabSpec<Student, StudentRow> = {
  name: 'students',
  entity: Student,
  excluded,
  // Every `ref` target above must be listed here, or `assertRegistryValid`
  // throws at boot (`registry.ts`). `classes`/`academic_years` are needed
  // even though they are not entity columns, because the `class` and
  // `academic_year` columns still resolve against those tabs.
  dependsOn: ['sections', 'guardians', 'users', 'classes', 'academic_years'],
  columns,
  naturalKey: ['registration_number'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Student[]> {
    // `class`/`academic_year` are derived from the section, not stored, so
    // `toRow` needs this full eager chain or it produces empty key
    // fragments. Default `find` excludes soft-deleted rows.
    return m.find(Student, {
      where: { tenant_id: tenantId },
      relations: [
        'user',
        'class_section',
        'class_section.class',
        'class_section.class.academic_year',
        'guardians',
      ],
    });
  },

  toRow(entity: Student, ctx: ExportContext): Record<string, unknown> {
    const guardianKeys = (entity.guardians ?? [])
      .map((g) => ctx.keyOf('guardians', g.id))
      // Sorted so the exported cell is stable regardless of the order
      // Postgres returns join rows in — without this the same data would
      // export as a different cell on different runs.
      .sort();

    return {
      id: entity.id,
      registration_number: entity.registration_number,
      full_name: entity.full_name,
      roll_number: entity.roll_number,
      section: ctx.keyOf('sections', entity.class_section_id),
      class: ctx.keyOf('classes', entity.class_section?.class_id ?? ''),
      academic_year: ctx.keyOf(
        'academic_years',
        entity.class_section?.class?.academic_year_id ?? '',
      ),
      date_of_birth: entity.date_of_birth,
      gender: entity.gender,
      home_address: entity.home_address,
      preferred_communication: entity.preferred_communication,
      enrollment_status: entity.enrollment_status,
      guardian_phones: guardianKeys,
      user: entity.user_id ? ctx.keyOf('users', entity.user_id) : null,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: StudentRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'students', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'students',
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

    const sectionKey = values.section as string;
    const sectionId = sectionKey ? ctx.ref('sections', sectionKey) : undefined;
    if (sectionKey && !sectionId) {
      errors.push({
        tab: 'students',
        row: rowNo,
        column: 'section',
        message: `Column "section": no section with the key "${sectionKey}" was found.`,
        severity: 'error',
        value: sectionKey,
      });
    }

    // `class`/`academic_year` are advisory only — resolved for validation
    // (so a wrong value is caught as a `RowError`), but `section` is the
    // authoritative parent and no further cross-check against it is done
    // here (`teacher-assignments.tab.ts` makes the same call).
    const classKey = values.class as string;
    const classId = classKey ? ctx.ref('classes', classKey) : undefined;
    if (classKey && !classId) {
      errors.push({
        tab: 'students',
        row: rowNo,
        column: 'class',
        message: `Column "class": no class named "${classKey}" was found.`,
        severity: 'error',
        value: classKey,
      });
    }

    const academicYearKey = values.academic_year as string;
    const academicYearId = academicYearKey ? ctx.ref('academic_years', academicYearKey) : undefined;
    if (academicYearKey && !academicYearId) {
      errors.push({
        tab: 'students',
        row: rowNo,
        column: 'academic_year',
        message: `Column "academic_year": no academic year named "${academicYearKey}" was found.`,
        severity: 'error',
        value: academicYearKey,
      });
    }

    const userKey = (values.user as string | null) ?? '';
    let userId: string | null = null;
    if (userKey) {
      const resolved = ctx.ref('users', userKey);
      if (!resolved) {
        errors.push({
          tab: 'students',
          row: rowNo,
          column: 'user',
          message: `Column "user": no user with the key "${userKey}" was found.`,
          severity: 'error',
          value: userKey,
        });
      } else {
        userId = resolved;
      }
    }

    const guardianKeys = (values.guardian_phones as string[]) ?? [];
    const guardianIdSet = new Set<string>();
    for (const key of guardianKeys) {
      const resolved = ctx.ref('guardians', key);
      if (!resolved) {
        errors.push({
          tab: 'students',
          row: rowNo,
          column: 'guardian_phones',
          message: `Column "guardian_phones": no guardian with the key "${key}" was found.`,
          severity: 'error',
          value: key,
        });
      } else {
        // De-duplicate: a cell listing the same guardian twice must not
        // produce two join rows.
        guardianIdSet.add(resolved);
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        registration_number: values.registration_number as string,
        full_name: values.full_name as string,
        roll_number: values.roll_number as number,
        class_section_id: sectionId as string,
        date_of_birth: (values.date_of_birth as string | null) ?? null,
        gender: (values.gender as string | null) ?? null,
        home_address: (values.home_address as string | null) ?? null,
        preferred_communication:
          (values.preferred_communication as CommunicationMedium | null) ?? CommunicationMedium.SMS,
        enrollment_status:
          (values.enrollment_status as EnrollmentStatus | null) ?? EnrollmentStatus.ACTIVE,
        guardian_ids: Array.from(guardianIdSet),
        user_id: userId,
        class_key: classKey,
        academic_year_key: academicYearKey,
        section_key: sectionKey,
        guardian_keys: guardianKeys,
        user_key: userKey || null,
      },
    };
  },

  // `registration_number` is a real column on both a row and an entity, and
  // (C1) is genuinely unique across the whole database, so no fallback chain
  // is needed here the way `guardians.tab.ts` needs one.
  keyOf(x: StudentRow | Student): string {
    return x.registration_number.trim();
  },

  diffFields(row: StudentRow, existing: Student): string[] {
    const changed: string[] = [];
    const fields = [
      'registration_number',
      'full_name',
      'roll_number',
      'gender',
      'home_address',
      'preferred_communication',
      'enrollment_status',
      'user_id',
    ] as const;
    for (const key of fields) {
      if (row[key] !== existing[key]) changed.push(key);
    }
    if (row.class_section_id !== existing.class_section_id) changed.push('section');
    if (row.date_of_birth !== formatDateOnly(existing.date_of_birth)) changed.push('date_of_birth');

    const rowGuardianKey = [...row.guardian_ids].sort().join(';');
    const existingGuardianKey = (existing.guardians ?? [])
      .map((g) => g.id)
      .sort()
      .join(';');
    if (rowGuardianKey !== existingGuardianKey) changed.push('guardian_phones');

    return changed;
  },

  async upsert(
    row: StudentRow,
    existing: Student | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Student> {
    // `registration_number` carries a GLOBAL unique constraint
    // (`UQ_82946fdb5652b83cacb81e9083e`), not tenant-scoped and not partial
    // on `deleted_at` (C1). The lookup below must NOT filter by tenant, and
    // must pass `withDeleted: true`, or a soft-deleted student blocking the
    // same registration number would surface as a bare `23505` instead of
    // being revived.
    let student = existing;
    if (!student) {
      student = await m.findOne(Student, {
        where: { registration_number: row.registration_number },
        withDeleted: true,
      });
    }

    if (student && student.tenant_id !== tenantId) {
      throw new Error(
        `Student with registration number "${row.registration_number}" already exists in tenant ` +
          `"${student.tenant_id}" and cannot be restored into tenant "${tenantId}".`,
      );
    }

    // `Student.user_id` also carries a GLOBAL unique constraint
    // (`REL_fb3eff90b11bddf7285f9b4e28`), not tenant-scoped and not partial
    // on `deleted_at` (C2) — same hazard as `Guardian.user_id`
    // (`guardians.tab.ts`).
    if (row.user_id && (!student || student.user_id !== row.user_id)) {
      const holder = await m.findOne(Student, {
        where: { user_id: row.user_id },
        withDeleted: true,
      });
      if (holder && holder.id !== student?.id) student = student ?? holder;
      if (holder && student && holder.id !== student.id) {
        throw new Error(
          `Student with user "${row.user_key ?? row.user_id}" already belongs to a different ` +
            `student record (tenant "${holder.tenant_id}") and cannot be reassigned by a restore.`,
        );
      }
    }

    if (student && student.tenant_id !== tenantId) {
      throw new Error(
        `Student with user "${row.user_key ?? row.user_id}" already exists in tenant ` +
          `"${student.tenant_id}" and cannot be restored into tenant "${tenantId}".`,
      );
    }

    if (student) {
      student.deleted_at = null;
    } else {
      student = new Student();
    }

    student.tenant_id = tenantId;
    student.registration_number = row.registration_number;
    student.full_name = row.full_name;
    // `roll_number` is unique per `class_section_id`
    // (`IDX_ca01941430b7d99b013e6c6948`, migrations/1784175065078-InitialSchema.ts:61).
    // This tab deliberately does NOT pre-check it: the restore executor (14.10.2)
    // maps a `23505` on that index to a per-row error. Do not add a lookup here.
    student.roll_number = row.roll_number;
    student.class_section_id = row.class_section_id;
    student.date_of_birth = row.date_of_birth ? new Date(row.date_of_birth) : null;
    student.gender = row.gender;
    student.home_address = row.home_address;
    student.preferred_communication = row.preferred_communication;
    student.enrollment_status = row.enrollment_status;
    student.user_id = row.user_id;
    // `guardians` is deliberately never assigned here (C7): `Student.guardians`
    // has `cascade: ['insert']`, and assigning it before `m.save` risks
    // TypeORM inserting a duplicate `Guardian` row. The join table is
    // reconciled explicitly below instead.

    const saved = await m.save(Student, student);

    const currentLinks = await m
      .createQueryBuilder()
      .relation(Student, 'guardians')
      .of(saved)
      .loadMany<Guardian>();
    const currentIds = new Set(currentLinks.map((g) => g.id));
    const desiredIds = new Set(row.guardian_ids);

    const toAdd = row.guardian_ids.filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !desiredIds.has(id));

    if (toAdd.length > 0 || toRemove.length > 0) {
      await m
        .createQueryBuilder()
        .relation(Student, 'guardians')
        .of(saved)
        .addAndRemove(toAdd, toRemove);
    }

    return saved;
  },

  async remove(entity: Student, m: EntityManager): Promise<void> {
    // Soft delete: link rows are left intact so a revive restores them.
    await m.softRemove(Student, entity);
  },
};

/**
 * Mirrors `academic-years.tab.ts`'s `formatDateOnly` for the local-calendar
 * -day comparison in `diffFields`. TypeORM hands a Postgres `date` column
 * back as a plain `YYYY-MM-DD` string, read straight through here to avoid a
 * UTC/local day shift.
 */
function formatDateOnly(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
