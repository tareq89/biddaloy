import type { EntityManager } from 'typeorm';
import { AdmissionApplicant } from '../../../admission/entities/admission-applicant.entity';
import { AdmissionApplicantStatus } from '@biddaloy/shared';
import { fromCell, formatDateOnly } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `admission_applicants` tab (Epic 27.0): a candidate applying against
 * one `admission_intakes` row.
 *
 * `reference_number` is unique per tenant (`admission-applicant.entity.ts`),
 * so it is the natural key rather than the intake/applicant-name pair — two
 * applicants can share a name.
 */
export interface AdmissionApplicantRow {
  id: string;
  intake_id: string;
  intake_key: string;
  reference_number: string;
  applicant_name: string;
  date_of_birth: string;
  gender: string;
  guardian_name: string;
  guardian_phone: string;
  guardian_email: string | null;
  home_address: string | null;
  documents: unknown[];
  status: AdmissionApplicantStatus;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'intake',
    type: 'ref',
    ref: 'admission_intakes',
    required: true,
    label: { en: 'Intake', bn: 'ভর্তি বিজ্ঞপ্তি' },
  },
  {
    key: 'reference_number',
    type: 'string',
    required: true,
    label: { en: 'Reference number', bn: 'রেফারেন্স নম্বর' },
  },
  {
    key: 'applicant_name',
    type: 'string',
    required: true,
    label: { en: 'Applicant name', bn: 'আবেদনকারীর নাম' },
  },
  {
    key: 'date_of_birth',
    type: 'date',
    required: true,
    label: { en: 'Date of birth', bn: 'জন্ম তারিখ' },
  },
  { key: 'gender', type: 'string', required: true, label: { en: 'Gender', bn: 'লিঙ্গ' } },
  {
    key: 'guardian_name',
    type: 'string',
    required: true,
    label: { en: 'Guardian name', bn: 'অভিভাবকের নাম' },
  },
  {
    key: 'guardian_phone',
    type: 'string',
    required: true,
    label: { en: 'Guardian phone', bn: 'অভিভাবকের ফোন' },
  },
  {
    key: 'guardian_email',
    type: 'string',
    label: { en: 'Guardian email', bn: 'অভিভাবকের ইমেইল' },
  },
  { key: 'home_address', type: 'string', label: { en: 'Home address', bn: 'বাসার ঠিকানা' } },
  { key: 'documents', type: 'json', label: { en: 'Documents', bn: 'নথি' } },
  {
    key: 'status',
    type: 'enum',
    required: true,
    enumValues: Object.values(AdmissionApplicantStatus),
    label: { en: 'Status', bn: 'অবস্থা' },
  },
];

const excluded: readonly string[] = [
  'intake_id', // exported instead as the `intake` ref column
];

const MAX_LENGTHS: Record<string, number> = {
  reference_number: 50,
  applicant_name: 200,
  gender: 20,
  guardian_name: 200,
  guardian_phone: 20,
  guardian_email: 200,
};

export const admissionApplicantsTab: TabSpec<AdmissionApplicant, AdmissionApplicantRow> = {
  name: 'admission_applicants',
  entity: AdmissionApplicant,
  excluded,
  dependsOn: ['admission_intakes'],
  columns,
  naturalKey: ['reference_number'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<AdmissionApplicant[]> {
    return m.find(AdmissionApplicant, {
      where: { tenant_id: tenantId },
      relations: ['intake'],
    });
  },

  toRow(entity: AdmissionApplicant, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      intake: ctx.keyOf('admission_intakes', entity.intake_id),
      reference_number: entity.reference_number,
      applicant_name: entity.applicant_name,
      date_of_birth: entity.date_of_birth,
      gender: entity.gender,
      guardian_name: entity.guardian_name,
      guardian_phone: entity.guardian_phone,
      guardian_email: entity.guardian_email,
      home_address: entity.home_address,
      documents: entity.documents ?? [],
      status: entity.status,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: AdmissionApplicantRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'admission_applicants', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'admission_applicants',
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

    const intakeKey = values.intake as string;
    const intakeId = ctx.ref('admission_intakes', intakeKey);
    if (!intakeId) {
      errors.push({
        tab: 'admission_applicants',
        row: rowNo,
        column: 'intake',
        message: `Column "intake": no admission intake with the key "${intakeKey}" was found.`,
        severity: 'error',
        value: intakeKey,
      });
    }

    if (
      values.documents !== null &&
      values.documents !== undefined &&
      !Array.isArray(values.documents)
    ) {
      errors.push({
        tab: 'admission_applicants',
        row: rowNo,
        column: 'documents',
        message: 'Column "documents": must be a JSON array, for example [].',
        severity: 'error',
        value: cells.documents ?? '',
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        intake_id: intakeId as string,
        intake_key: intakeKey,
        reference_number: values.reference_number as string,
        applicant_name: values.applicant_name as string,
        date_of_birth: values.date_of_birth as string,
        gender: values.gender as string,
        guardian_name: values.guardian_name as string,
        guardian_phone: values.guardian_phone as string,
        guardian_email: (values.guardian_email as string | null) ?? null,
        home_address: (values.home_address as string | null) ?? null,
        documents: (values.documents as unknown[] | null) ?? [],
        status: values.status as AdmissionApplicantStatus,
      },
    };
  },

  keyOf(x: AdmissionApplicantRow | AdmissionApplicant): string {
    return x.reference_number.trim();
  },

  diffFields(row: AdmissionApplicantRow, existing: AdmissionApplicant): string[] {
    const changed: string[] = [];
    if (row.intake_id !== existing.intake_id) changed.push('intake');
    if (row.applicant_name !== existing.applicant_name) changed.push('applicant_name');
    if (row.date_of_birth !== formatDateOnly(existing.date_of_birth)) changed.push('date_of_birth');
    if (row.gender !== existing.gender) changed.push('gender');
    if (row.guardian_name !== existing.guardian_name) changed.push('guardian_name');
    if (row.guardian_phone !== existing.guardian_phone) changed.push('guardian_phone');
    if (row.guardian_email !== existing.guardian_email) changed.push('guardian_email');
    if (row.home_address !== existing.home_address) changed.push('home_address');
    if (JSON.stringify(row.documents) !== JSON.stringify(existing.documents)) {
      changed.push('documents');
    }
    if (row.status !== existing.status) changed.push('status');
    return changed;
  },

  async upsert(
    row: AdmissionApplicantRow,
    existing: AdmissionApplicant | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<AdmissionApplicant> {
    const applicant = existing ?? new AdmissionApplicant();
    applicant.tenant_id = tenantId;
    applicant.intake_id = row.intake_id;
    applicant.reference_number = row.reference_number;
    applicant.applicant_name = row.applicant_name;
    applicant.date_of_birth = row.date_of_birth;
    applicant.gender = row.gender;
    applicant.guardian_name = row.guardian_name;
    applicant.guardian_phone = row.guardian_phone;
    applicant.guardian_email = row.guardian_email;
    applicant.home_address = row.home_address;
    applicant.documents = row.documents as AdmissionApplicant['documents'];
    applicant.status = row.status;

    return m.save(AdmissionApplicant, applicant);
  },

  async remove(entity: AdmissionApplicant, m: EntityManager): Promise<void> {
    await m.softRemove(AdmissionApplicant, entity);
  },
};
