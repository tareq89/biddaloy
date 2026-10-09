import { In, type EntityManager } from 'typeorm';
import { APPLICATION_TAG_ROLES, ATTACHMENT_LIMITS, ApplicationEventKind } from '@biddaloy/shared';
import { UserTenant } from '../../../auth/entities/user-tenant.entity';
import { ApplicationAttachment } from '../../../applications/entities/application-attachment.entity';
import { ApplicationEvent } from '../../../applications/entities/application-event.entity';
import { ApplicationTag } from '../../../applications/entities/application-tag.entity';
import { fromCell } from '../../codec/cell-format';
import { rehomeStorageKey } from '../../codec/storage-key-scope';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { createRefChildTab } from '../people/ref-child-tab.factory';
import { usersTab } from '../people/users.tab';
import { applicationsTab } from './applications.tab';

/**
 * [52.1.6] The three tabs hanging off `applications`. Child rows always take
 * their tenant from the importing school (`upsert`'s `tenantId`) and reach
 * their parent only through `ctx.ref('applications', …)`, which holds the
 * importing school's applications alone.
 */
type Rec = Record<string, unknown>;
const ID_COLUMN: ColumnSpec = {
  key: 'id',
  type: 'uuid',
  required: true,
  label: { en: 'ID', bn: 'আইডি' },
};
const APPLICATION_LABEL = { en: 'Application', bn: 'আবেদন' };

// --- events: append-only timeline, all refs required, so the factory fits ---
export const applicationEventsTab = createRefChildTab<ApplicationEvent>({
  name: 'application_events',
  entityClass: ApplicationEvent,
  refs: [
    { key: 'application', fk: 'application_id', tab: applicationsTab, label: APPLICATION_LABEL },
    { key: 'actor', fk: 'actor_user_id', tab: usersTab, label: { en: 'Actor', bn: 'সম্পাদনকারী' } },
  ],
  fields: [
    {
      key: 'kind',
      type: 'enum',
      required: true,
      enumValues: Object.values(ApplicationEventKind),
      label: { en: 'Kind', bn: 'ধরন' },
    },
    { key: 'step', type: 'int', label: { en: 'Step', bn: 'ধাপ' } },
    { key: 'note', type: 'string', label: { en: 'Note', bn: 'মন্তব্য' } },
    { key: 'data', type: 'json', label: { en: 'Data', bn: 'তথ্য' } },
    {
      key: 'created_at',
      type: 'datetime',
      required: true,
      label: { en: 'Created at', bn: 'তৈরির সময়' },
    },
  ],
  // `id` last: created_at defaults to now() (identical within one transaction), so two
  // same-kind events on one application would otherwise collide.
  naturalKey: ['application', 'kind', 'created_at', 'id'],
});

/** Loads a parent tab's rows once and returns id -> natural key. */
async function keysById(
  tab: { load(t: string, m: EntityManager): Promise<any[]>; keyOf(x: any): string },
  tenantId: string,
  m: EntityManager,
): Promise<Map<string, string>> {
  return new Map((await tab.load(tenantId, m)).map((p) => [p.id as string, tab.keyOf(p)]));
}

const error = (
  tab: string,
  rowNo: number,
  column: string | null,
  message: string,
  value?: string,
): RowError => ({
  tab,
  row: rowNo,
  column,
  message,
  severity: 'error',
  value,
});

/** Resolves a required ref cell to an id, or pushes an error. */
function resolve(
  ctx: ImportContext,
  errors: RowError[],
  tab: string,
  rowNo: number,
  column: string,
  refTab: string,
  key: string,
): string | null {
  const id = ctx.ref(refTab, key);
  if (!id) {
    errors.push(
      error(
        tab,
        rowNo,
        column,
        `Column "${column}": no ${refTab} row with the key "${key}" was found.`,
        key,
      ),
    );
  }
  return id ?? null;
}

function parseCells(
  columns: readonly ColumnSpec[],
  tab: string,
  cells: Record<string, string>,
  rowNo: number,
  errors: RowError[],
): Rec {
  const values: Rec = {};
  for (const column of columns) {
    const result = fromCell(column, cells[column.key] ?? '', tab, rowNo);
    if ('error' in result) errors.push(result.error);
    else values[column.key] = result.value;
  }
  return values;
}

// --- tags: `user` is nullable (a tag is a person OR a role) ---
const TAGS = 'application_tags';
const tagColumns: readonly ColumnSpec[] = [
  ID_COLUMN,
  {
    key: 'application',
    type: 'ref',
    ref: 'applications',
    required: true,
    label: APPLICATION_LABEL,
  },
  {
    key: 'user',
    type: 'ref',
    ref: 'users',
    label: { en: 'Tagged user', bn: 'ট্যাগ করা ব্যবহারকারী' },
  },
  { key: 'role', type: 'string', label: { en: 'Tagged role', bn: 'ট্যাগ করা ভূমিকা' } },
  {
    key: 'created_by',
    type: 'ref',
    ref: 'users',
    required: true,
    label: { en: 'Created by', bn: 'তৈরি করেছেন' },
  },
];
const STAMP = '__keys';

export const applicationTagsTab: TabSpec<ApplicationTag, Rec> = {
  name: TAGS,
  entity: ApplicationTag,
  excluded: [
    'application_id', // exported instead as the `application` ref column
    'user_id', // exported instead as the `user` ref column
    'created_by_user_id', // exported instead as the `created_by` ref column
    'created_at', // set by the database on insert
    'tenant_id', // implicit: every row is scoped to the workbook's own tenant
  ],
  dependsOn: ['applications', 'users'],
  columns: tagColumns,
  naturalKey: ['application', 'user', 'role'],
  deleteByAbsence: true,

  async load(tenantId: string, m: EntityManager): Promise<ApplicationTag[]> {
    const rows = await m.find(ApplicationTag, { where: { tenant_id: tenantId } });
    const apps = await keysById(applicationsTab, tenantId, m);
    const users = await keysById(usersTab, tenantId, m);
    for (const r of rows) {
      const app = apps.get(r.application_id);
      const user = r.user_id ? users.get(r.user_id) : '';
      if (app === undefined || user === undefined) {
        throw new Error(
          `Workbook export: tab "${TAGS}" row ${r.id} has a parent that is not exportable.`,
        );
      }
      (r as unknown as Rec)[STAMP] = { application: app, user };
    }
    return rows;
  },

  toRow(entity: ApplicationTag, ctx: ExportContext): Rec {
    return {
      id: entity.id,
      application: ctx.keyOf('applications', entity.application_id),
      user: entity.user_id ? ctx.keyOf('users', entity.user_id) : null,
      role: entity.role,
      created_by: ctx.keyOf('users', entity.created_by_user_id),
    };
  },

  fromRow(cells, rowNo, ctx) {
    const errors: RowError[] = [];
    const v = parseCells(tagColumns, TAGS, cells, rowNo, errors);
    if (errors.length > 0) return { errors };
    const role = (v.role as string | null) ?? '';
    const userKey = (v.user as string | null) ?? '';
    // Same list as the DB CHECK `CHK_application_tags_role` (tenant staff only, D50).
    if (role && !(APPLICATION_TAG_ROLES as readonly string[]).includes(role)) {
      errors.push(
        error(
          TAGS,
          rowNo,
          'role',
          `Column "role": must be one of ${APPLICATION_TAG_ROLES.join(', ')}.`,
          role,
        ),
      );
    }
    // Same rule as the DB CHECK: exactly one of user / role.
    if (!!role === !!userKey) {
      errors.push(error(TAGS, rowNo, null, 'Exactly one of "user" and "role" must be filled.'));
    }
    const applicationId = resolve(
      ctx,
      errors,
      TAGS,
      rowNo,
      'application',
      'applications',
      v.application as string,
    );
    const userId = userKey ? resolve(ctx, errors, TAGS, rowNo, 'user', 'users', userKey) : null;
    const createdBy = resolve(
      ctx,
      errors,
      TAGS,
      rowNo,
      'created_by',
      'users',
      v.created_by as string,
    );
    if (errors.length > 0) return { errors };
    return {
      row: {
        id: v.id,
        application_id: applicationId,
        user_id: userId,
        role: role || null,
        created_by_user_id: createdBy,
        application_key: v.application,
        user_key: userKey,
      },
    };
  },

  keyOf(x: Rec | ApplicationTag): string {
    if (x instanceof ApplicationTag) {
      const k = (x as unknown as Rec)[STAMP] as Rec | undefined;
      return `${k?.application ?? ''}|${k?.user ?? ''}|${x.role ?? ''}`;
    }
    return `${x.application_key}|${x.user_key}|${x.role ?? ''}`;
  },

  diffFields(row: Rec, existing: ApplicationTag): string[] {
    return row.created_by_user_id === existing.created_by_user_id ? [] : ['created_by'];
  },

  async upsert(row: Rec, existing: ApplicationTag | null, tenantId: string, m: EntityManager) {
    // D50: a user tag grants read access, so it must name this school's staff, never a
    // guardian or student login. Checked here because fromRow has no database access.
    // Only for a new tag or a changed user: an existing tag whose user has since left
    // the staff must not stop the school's own backup from restoring.
    if (row.user_id && existing?.user_id !== row.user_id) {
      const isStaff = await m.exists(UserTenant, {
        where: {
          user_id: row.user_id as string,
          tenant_id: tenantId,
          role: In([...APPLICATION_TAG_ROLES]),
        },
      });
      if (!isStaff) {
        throw new Error(
          `${TAGS}: user "${String(row.user_key)}" is not staff of this school (D50).`,
        );
      }
    }
    const tag = existing ?? new ApplicationTag();
    tag.tenant_id = tenantId;
    tag.application_id = row.application_id as string;
    tag.user_id = row.user_id as string | null;
    tag.role = row.role as string | null;
    tag.created_by_user_id = row.created_by_user_id as string;
    return m.save(ApplicationTag, tag);
  },

  async remove(entity: ApplicationTag, m: EntityManager): Promise<void> {
    await m.remove(ApplicationTag, entity);
  },
};

// --- attachments: metadata only; storage_key is re-homed to the importing school ---
const ATT = 'application_attachments';
const attachmentColumns: readonly ColumnSpec[] = [
  ID_COLUMN,
  {
    key: 'application',
    type: 'ref',
    ref: 'applications',
    required: true,
    label: APPLICATION_LABEL,
  },
  {
    key: 'storage_key',
    type: 'string',
    required: true,
    label: { en: 'Storage key', bn: 'সংরক্ষণ কী' },
  },
  {
    key: 'file_name',
    type: 'string',
    required: true,
    label: { en: 'File name', bn: 'ফাইলের নাম' },
  },
  {
    key: 'mime_type',
    type: 'string',
    required: true,
    label: { en: 'File type', bn: 'ফাইলের ধরন' },
  },
  {
    key: 'size_bytes',
    type: 'int',
    required: true,
    label: { en: 'Size (bytes)', bn: 'আকার (বাইট)' },
  },
  {
    key: 'uploaded_by',
    type: 'ref',
    ref: 'users',
    required: true,
    label: { en: 'Uploaded by', bn: 'আপলোডকারী' },
  },
];
const ATT_MAX: Record<string, number> = { storage_key: 512, file_name: 255, mime_type: 100 };

export const applicationAttachmentsTab: TabSpec<ApplicationAttachment, Rec> = {
  name: ATT,
  entity: ApplicationAttachment,
  excluded: [
    'application_id', // exported instead as the `application` ref column
    'uploaded_by_user_id', // exported instead as the `uploaded_by` ref column
    'created_at', // set by the database on insert
    'tenant_id', // implicit: every row is scoped to the workbook's own tenant
  ],
  dependsOn: ['applications', 'users'],
  columns: attachmentColumns,
  naturalKey: ['storage_key'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<ApplicationAttachment[]> {
    return m.find(ApplicationAttachment, { where: { tenant_id: tenantId } });
  },

  toRow(entity: ApplicationAttachment, ctx: ExportContext): Rec {
    return {
      id: entity.id,
      application: ctx.keyOf('applications', entity.application_id),
      storage_key: entity.storage_key,
      file_name: entity.file_name,
      mime_type: entity.mime_type,
      size_bytes: entity.size_bytes,
      uploaded_by: ctx.keyOf('users', entity.uploaded_by_user_id),
    };
  },

  fromRow(cells, rowNo, ctx) {
    const errors: RowError[] = [];
    const v = parseCells(attachmentColumns, ATT, cells, rowNo, errors);
    if (errors.length > 0) return { errors };
    for (const [col, limit] of Object.entries(ATT_MAX)) {
      if ((v[col] as string).length > limit) {
        errors.push(
          error(
            ATT,
            rowNo,
            col,
            `Column "${col}": is longer than the ${limit} characters allowed.`,
            v[col] as string,
          ),
        );
      }
    }
    // D10: the stored type is what the file is served as, so an edited sheet must not relabel it.
    const mime = v.mime_type as string;
    if (!(ATTACHMENT_LIMITS.mime as readonly string[]).includes(mime)) {
      errors.push(
        error(
          ATT,
          rowNo,
          'mime_type',
          `Column "mime_type": must be one of ${ATTACHMENT_LIMITS.mime.join(', ')}.`,
          mime,
        ),
      );
    }
    const size = v.size_bytes as number;
    if (size < 0 || size > ATTACHMENT_LIMITS.maxBytes) {
      errors.push(
        error(
          ATT,
          rowNo,
          'size_bytes',
          `Column "size_bytes": must be between 0 and ${ATTACHMENT_LIMITS.maxBytes}.`,
          String(size),
        ),
      );
    }
    // A key from another school must never survive: it would let this school stream that file.
    const rawKey = v.storage_key as string;
    const rehomed = rehomeStorageKey(rawKey, ctx.tenantId);
    if (!rehomed || !/^applications\/[^/]+$/.test(rehomed.tail)) {
      errors.push(
        error(
          ATT,
          rowNo,
          'storage_key',
          `Column "storage_key": "${rawKey}" is not a valid attachment storage key.`,
          rawKey,
        ),
      );
    } else if (rehomed.moved) {
      ctx.warn({
        tab: ATT,
        row: rowNo,
        column: 'storage_key',
        message: `This file came from another school. It was not copied; re-upload it (${rehomed.tail}).`,
        severity: 'warning',
        value: rawKey,
      });
    }
    const applicationId = resolve(
      ctx,
      errors,
      ATT,
      rowNo,
      'application',
      'applications',
      v.application as string,
    );
    const uploadedBy = resolve(
      ctx,
      errors,
      ATT,
      rowNo,
      'uploaded_by',
      'users',
      v.uploaded_by as string,
    );
    if (errors.length > 0 || !rehomed) return { errors };
    return {
      row: {
        id: v.id,
        application_id: applicationId,
        storage_key: rehomed.key,
        file_name: v.file_name,
        mime_type: v.mime_type,
        size_bytes: v.size_bytes,
        uploaded_by_user_id: uploadedBy,
      },
    };
  },

  keyOf(x: Rec | ApplicationAttachment): string {
    return x.storage_key as string;
  },

  diffFields(row: Rec, existing: ApplicationAttachment): string[] {
    const e = existing as unknown as Rec;
    const pairs: [string, string][] = [
      ['application', 'application_id'],
      ['file_name', 'file_name'],
      ['mime_type', 'mime_type'],
      ['size_bytes', 'size_bytes'],
      ['uploaded_by', 'uploaded_by_user_id'],
    ];
    return pairs.filter(([, prop]) => row[prop] !== e[prop]).map(([col]) => col);
  },

  async upsert(
    row: Rec,
    existing: ApplicationAttachment | null,
    tenantId: string,
    m: EntityManager,
  ) {
    const a = existing ?? new ApplicationAttachment();
    a.tenant_id = tenantId;
    a.application_id = row.application_id as string;
    a.storage_key = row.storage_key as string;
    a.file_name = row.file_name as string;
    a.mime_type = row.mime_type as string;
    a.size_bytes = row.size_bytes as number;
    a.uploaded_by_user_id = row.uploaded_by_user_id as string;
    return m.save(ApplicationAttachment, a);
  },

  async remove(entity: ApplicationAttachment, m: EntityManager): Promise<void> {
    await m.remove(ApplicationAttachment, entity);
  },
};
