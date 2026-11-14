import type { EntityManager, ObjectLiteral } from 'typeorm';
import {
  AdmissionListKind,
  AdmissionListOrder,
  AdmissionPayMethod,
  AdmissionFeeState,
  AdmissionStageKind,
} from '@biddaloy/shared';
import { AdmissionStage } from '../../../admission/entities/admission-stage.entity';
import { AdmissionStageResult } from '../../../admission/entities/admission-stage-result.entity';
import { AdmissionList } from '../../../admission/entities/admission-list.entity';
import { AdmissionListMember } from '../../../admission/entities/admission-list-member.entity';
import { AdmissionFeeProof } from '../../../admission/entities/admission-fee-proof.entity';
import { fromCell } from '../../codec/cell-format';
import { ownStorageKey } from '../../codec/storage-key-scope';
import { optionalKeyOf } from '../../codec/tab-spec';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { admissionIntakesTab } from './admission-intakes.tab';
import { admissionApplicantsTab } from './admission-applicants.tab';

/**
 * [71.1.05] The five tables Epic 71 adds: stages, stage results, lists, list
 * members, fee proofs. They are small clones of one shape, so one factory builds
 * them. Each parent link is a `ref` cell; the natural key is the parents' keys
 * plus one own cell. Row errors use fixed text (Rule 23): a submitted key goes in
 * `value` only, never in `message`.
 *
 * `admission_stages` (and lists) sit after `admission_intakes`; results and
 * members after their stage/list and `admission_applicants`; fee proofs after the
 * applicants and `users`.
 */
type Rec = Record<string, unknown>;
const INT4_MAX = 2147483647;
const label = (en: string, bn: string) => ({ en, bn });
const ID: ColumnSpec = { key: 'id', type: 'uuid', required: true, label: label('ID', 'আইডি') };

interface Parent {
  cell: string; // the `ref` column
  tab: string;
  idProp: string; // entity column that holds the id
  rel: string; // entity relation (loaded) used to build the key
  keyOf: () => (x: any) => string;
  required: boolean;
  /** Relation paths `load` needs so `keyOf(entity)` can build the parent key. */
  rels?: string[];
}
interface Def {
  name: string;
  entity: new () => ObjectLiteral;
  parents: Parent[];
  columns: ColumnSpec[]; // after id + parents
  scalars: string[]; // entity props copied as-is (same as the cell key)
  ints?: string[]; // checked against int4 range
  keyCells: string[]; // cells joined with `|`; parent cells use the parent key
  /** Extra per-row checks and cell rewrites. Push to `bad`; mutate `v` to normalise. */
  check?: (
    v: Rec,
    bad: (column: string, message: string) => void,
    ctx: ImportContext,
    rowNo: number,
  ) => void;
}

function makeTab(d: Def): TabSpec<any, Rec> {
  const columns: ColumnSpec[] = [
    ID,
    ...d.parents.map((p): ColumnSpec => ({
      key: p.cell,
      type: 'ref',
      ref: p.tab,
      required: p.required,
      label: label(p.cell, p.cell),
    })),
    ...d.columns,
  ];
  const parentCells = new Map(d.parents.map((p) => [p.cell, p]));
  return {
    name: d.name,
    entity: d.entity,
    excluded: [
      ...d.parents.map((p) => p.idProp), // exported instead as the `ref` columns
    ],
    dependsOn: d.parents.map((p) => p.tab),
    columns,
    naturalKey: d.keyCells,
    deleteByAbsence: true,

    load: (tenantId: string, m: EntityManager) =>
      m.find(d.entity, {
        where: { tenant_id: tenantId },
        relations: d.parents.flatMap((p) => (p.required ? [p.rel, ...(p.rels ?? [])] : [])),
      } as never),

    toRow(e: Rec, ctx: ExportContext): Rec {
      const row: Rec = { id: e.id };
      for (const p of d.parents) {
        const id = e[p.idProp] as string | null;
        row[p.cell] = id
          ? p.required
            ? ctx.keyOf(p.tab, id)
            : optionalKeyOf(ctx, p.tab, id)
          : null;
      }
      for (const s of d.scalars) row[s] = e[s] ?? null;
      return row;
    },

    fromRow(cells: Record<string, string>, rowNo: number, ctx: ImportContext) {
      const errors: RowError[] = [];
      const v: Rec = {};
      for (const c of columns) {
        const r = fromCell(c, cells[c.key] ?? '', d.name, rowNo);
        if ('error' in r) errors.push(r.error);
        else v[c.key] = r.value;
      }
      if (errors.length > 0) return { errors };
      const bad = (column: string, message: string) =>
        errors.push({
          tab: d.name,
          row: rowNo,
          column,
          message,
          severity: 'error',
          value: cells[column] ?? '',
        });
      const out: Rec = { id: v.id };
      for (const p of d.parents) {
        const key = (v[p.cell] as string | null) ?? '';
        const id = key ? (ctx.ref(p.tab, key) ?? null) : null;
        if (key && !id) bad(p.cell, `Column "${p.cell}": no such row was found.`);
        out[p.idProp] = id;
        out[`${p.cell}_key`] = key;
      }
      for (const k of d.ints ?? []) {
        const n = v[k] as number | null;
        if (n !== null && (n < 0 || n > INT4_MAX)) bad(k, `Column "${k}": is out of range.`);
      }
      d.check?.(v, bad, ctx, rowNo);
      if (errors.length > 0) return { errors };
      for (const s of d.scalars) out[s] = v[s] ?? null;
      return { row: out };
    },

    keyOf(x: Rec): string {
      return d.keyCells
        .map((cell) => {
          const p = parentCells.get(cell);
          if (!p) return String(x[cell] ?? '');
          const parent = x[p.rel];
          if (parent) return p.keyOf()(parent);
          return String(x[`${cell}_key`] ?? x[p.idProp] ?? '');
        })
        .join('|');
    },

    diffFields(row: Rec, existing: Rec): string[] {
      const changed = d.parents
        .filter((p) => row[p.idProp] !== existing[p.idProp])
        .map((p) => p.cell);
      for (const s of d.scalars) {
        if (JSON.stringify(row[s] ?? null) !== JSON.stringify(existing[s] ?? null)) changed.push(s);
      }
      return changed;
    },

    async upsert(row: Rec, existing: Rec | null, tenantId: string, m: EntityManager) {
      const e = (existing ?? new d.entity()) as Rec;
      e.tenant_id = tenantId;
      for (const p of d.parents) e[p.idProp] = row[p.idProp];
      for (const s of d.scalars) e[s] = row[s];
      return m.save(d.entity, e as never);
    },

    async remove(entity: Rec, m: EntityManager): Promise<void> {
      await m.softRemove(d.entity, entity as never);
    },
  } as TabSpec<any, Rec>;
}

/** What `admissionIntakesTab.keyOf(entity)` reads, under a relation prefix. */
const intakeRels = (prefix: string) => [
  `${prefix}.class_section`,
  `${prefix}.class_section.class`,
  `${prefix}.class_section.class.academic_year`,
];
const intakeParent: Parent = {
  cell: 'intake',
  tab: 'admission_intakes',
  idProp: 'intake_id',
  rel: 'intake',
  keyOf: () => (x) => admissionIntakesTab.keyOf(x),
  required: true,
  rels: intakeRels('intake'),
};
const applicantParent: Parent = {
  cell: 'applicant',
  tab: 'admission_applicants',
  idProp: 'applicant_id',
  rel: 'applicant',
  keyOf: () => (x) => admissionApplicantsTab.keyOf(x),
  required: true,
};

const jsonObject = (v: Rec, key: string, bad: (c: string, m: string) => void) => {
  const x = v[key] ?? {};
  if (typeof x !== 'object' || x === null || Array.isArray(x))
    bad(key, `Column "${key}": must be a JSON object, for example {}.`);
  else v[key] = x;
};

export const admissionStagesTab = makeTab({
  name: 'admission_stages',
  entity: AdmissionStage,
  parents: [intakeParent],
  columns: [
    { key: 'position', type: 'int', required: true, label: label('Position', 'অবস্থান') },
    {
      key: 'kind',
      type: 'enum',
      required: true,
      enumValues: Object.values(AdmissionStageKind),
      label: label('Kind', 'ধরন'),
    },
    { key: 'title', type: 'string', label: label('Title', 'শিরোনাম') },
    { key: 'config', type: 'json', label: label('Config', 'কনফিগ') },
  ],
  scalars: ['position', 'kind', 'title', 'config'],
  ints: ['position'],
  keyCells: ['intake', 'position'],
  check: (v, bad) => {
    if (typeof v.title === 'string' && v.title.length > 200)
      bad('title', 'Column "title": is longer than 200 characters.');
    jsonObject(v, 'config', bad);
  },
});

export const admissionStageResultsTab = makeTab({
  name: 'admission_stage_results',
  entity: AdmissionStageResult,
  parents: [
    {
      cell: 'stage',
      tab: 'admission_stages',
      idProp: 'stage_id',
      rel: 'stage',
      keyOf: () => (x) => admissionStagesTab.keyOf(x),
      required: true,
      rels: ['stage.intake', ...intakeRels('stage.intake')],
    },
    applicantParent,
  ],
  columns: [
    { key: 'score', type: 'money', label: label('Score', 'নম্বর') },
    { key: 'passed', type: 'bool', label: label('Passed', 'উত্তীর্ণ') },
    { key: 'remarks', type: 'string', label: label('Remarks', 'মন্তব্য') },
  ],
  scalars: ['score', 'passed', 'remarks'],
  keyCells: ['stage', 'applicant'],
  check: (v, bad) => {
    // numeric(8,2): at most 999999.99, so a bigger score is a row error, not a failed save.
    if (typeof v.score === 'string' && Number(v.score) >= 1_000_000)
      bad('score', 'Column "score": is out of range.');
  },
});

export const admissionListsTab = makeTab({
  name: 'admission_lists',
  entity: AdmissionList,
  parents: [intakeParent],
  columns: [
    {
      key: 'kind',
      type: 'enum',
      required: true,
      enumValues: Object.values(AdmissionListKind),
      label: label('Kind', 'ধরন'),
    },
    { key: 'sequence', type: 'int', required: true, label: label('Sequence', 'ক্রম') },
    {
      key: 'order_by',
      type: 'enum',
      required: true,
      enumValues: Object.values(AdmissionListOrder),
      label: label('Order by', 'সাজানোর ধরন'),
    },
    { key: 'active', type: 'bool', required: true, label: label('Active', 'সক্রিয়') },
    { key: 'published_at', type: 'datetime', label: label('Published at', 'প্রকাশের সময়') },
  ],
  scalars: ['kind', 'sequence', 'order_by', 'active', 'published_at'],
  ints: ['sequence'],
  keyCells: ['intake', 'kind', 'sequence'],
});

export const admissionListMembersTab = makeTab({
  name: 'admission_list_members',
  entity: AdmissionListMember,
  parents: [
    {
      cell: 'list',
      tab: 'admission_lists',
      idProp: 'list_id',
      rel: 'list',
      keyOf: () => (x) => admissionListsTab.keyOf(x),
      required: true,
      rels: ['list.intake', ...intakeRels('list.intake')],
    },
    applicantParent,
  ],
  columns: [{ key: 'position', type: 'int', required: true, label: label('Position', 'অবস্থান') }],
  scalars: ['position'],
  ints: ['position'],
  keyCells: ['list', 'applicant'],
});

export const admissionFeeProofsTab = makeTab({
  name: 'admission_fee_proofs',
  entity: AdmissionFeeProof,
  parents: [
    applicantParent,
    {
      cell: 'verified_by',
      tab: 'users',
      idProp: 'verified_by_user_id',
      rel: 'verified_by',
      keyOf: () => () => '',
      required: false,
    },
  ],
  columns: [
    { key: 'attachment_key', type: 'string', required: true, label: label('File key', 'ফাইল কী') },
    {
      key: 'method',
      type: 'enum',
      required: true,
      enumValues: Object.values(AdmissionPayMethod),
      label: label('Method', 'মাধ্যম'),
    },
    { key: 'reference', type: 'string', label: label('Reference', 'রেফারেন্স') },
    {
      key: 'state',
      type: 'enum',
      required: true,
      enumValues: Object.values(AdmissionFeeState),
      label: label('State', 'অবস্থা'),
    },
    { key: 'reason', type: 'string', label: label('Reason', 'কারণ') },
  ],
  scalars: ['attachment_key', 'method', 'reference', 'state', 'reason'],
  keyCells: ['applicant', 'attachment_key'],
  check: (v, bad, ctx, rowNo) => {
    if (typeof v.reference === 'string' && v.reference.length > 100)
      bad('reference', 'Column "reference": is longer than 100 characters.');
    // Same school folder as the applicant documents: a key outside it, or another school's, never sticks (DATA-02).
    const owned = ownStorageKey(
      v.attachment_key as string,
      ctx.tenantId,
      'admission_fee_proofs',
      rowNo,
      'attachment_key',
      'admission-documents',
    );
    if ('error' in owned) bad('attachment_key', owned.error.message);
    else {
      v.attachment_key = owned.key;
      if (owned.warning) ctx.warn(owned.warning);
    }
  },
});

export const admissionPipelineTabs = [
  admissionStagesTab,
  admissionStageResultsTab,
  admissionListsTab,
  admissionListMembersTab,
  admissionFeeProofsTab,
];
