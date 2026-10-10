import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import type { ImportContext } from '../../codec/tab-spec';
import {
  applicationAttachmentsTab,
  applicationEventsTab,
  applicationTagsTab,
} from './application-children.tab';
import { usersTab } from '../people/users.tab';
import { applicationsTab } from './applications.tab';
import { ApplicationTag } from '../../../applications/entities/application-tag.entity';

const TENANT = 'tenant-b';
const ctx = (warnings: unknown[] = []): ImportContext => ({
  tenantId: TENANT,
  ref: (_tab, key) => `id-of-${key}`,
  warn: (w) => warnings.push(w),
});

const UUID = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const base = {
  id: UUID,
  serial_year: '2026',
  serial_no: '1',
  type: 'GENERAL',
  status: 'PENDING',
  source: 'APP',
  payload: '{}',
  current_step: '0',
  letter_text: 'x',
  letter_locale: 'en',
  applicant: 'a@x.test',
  subject_student: 'REG-1',
};

const messages = (r: ReturnType<typeof applicationsTab.fromRow>) =>
  'errors' in r ? r.errors.map((e) => e.message).join(' | ') : '';

describe('applications tab fromRow', () => {
  it('accepts exactly one subject', () => {
    expect('row' in applicationsTab.fromRow(base, 2, ctx())).toBe(true);
  });

  it('rejects both subjects, and neither subject', () => {
    const both = applicationsTab.fromRow({ ...base, subject_staff_profile: 'E-1' }, 2, ctx());
    const neither = applicationsTab.fromRow({ ...base, subject_student: '' }, 2, ctx());
    expect(messages(both)).toContain('Exactly one of');
    expect(messages(neither)).toContain('Exactly one of');
  });

  it('rejects an APP row with no applicant, but accepts a PAPER row with applicant_name', () => {
    const noApplicant = { ...base, applicant: '' };
    expect(messages(applicationsTab.fromRow(noApplicant, 2, ctx()))).toContain('"applicant"');
    const app = applicationsTab.fromRow(noApplicant, 2, ctx());
    expect('errors' in app).toBe(true);
    const paper = applicationsTab.fromRow(
      { ...noApplicant, source: 'PAPER', applicant_name: 'Karim' },
      2,
      ctx(),
    );
    expect('row' in paper).toBe(true);
  });

  it('accepts only bn/en as the letter language', () => {
    const r = applicationsTab.fromRow({ ...base, letter_locale: 'fr' }, 2, ctx());
    expect('errors' in r).toBe(true);
  });

  it('accepts CANCELLED only on a cancellable (leave) type (D31)', () => {
    const general = applicationsTab.fromRow({ ...base, status: 'CANCELLED' }, 2, ctx());
    expect(messages(general)).toContain('cannot be CANCELLED');
    const leave = applicationsTab.fromRow(
      { ...base, type: 'STUDENT_LEAVE', status: 'CANCELLED' },
      2,
      ctx(),
    );
    expect('row' in leave).toBe(true);
  });

  it('rejects a subject kind the type does not allow (APPLICATION_TYPES[type].subject)', () => {
    const staffOnly = applicationsTab.fromRow({ ...base, type: 'STAFF_LEAVE' }, 2, ctx());
    expect(messages(staffOnly)).toContain('cannot have a student subject');
    const staff = applicationsTab.fromRow(
      { ...base, type: 'STAFF_LEAVE', subject_student: '', subject_staff_profile: 'E-1' },
      2,
      ctx(),
    );
    expect('row' in staff).toBe(true);
  });
});

describe('application_tags tab fromRow', () => {
  const tag = { id: UUID, application: '2026|1', created_by: 'a@x.test' };
  it('rejects both user and role, and neither', () => {
    const both = applicationTagsTab.fromRow({ ...tag, user: 'b@x.test', role: 'ADMIN' }, 2, ctx());
    const neither = applicationTagsTab.fromRow(tag, 2, ctx());
    expect('errors' in both && 'errors' in neither).toBe(true);
  });
  it('accepts a role-only tag', () => {
    expect('row' in applicationTagsTab.fromRow({ ...tag, role: 'ADMIN' }, 2, ctx())).toBe(true);
  });
  it('rejects a role that is not a tenant staff role (D50)', () => {
    for (const role of ['Admin', 'SUPER_ADMIN', 'PARENT']) {
      expect('errors' in applicationTagsTab.fromRow({ ...tag, role }, 2, ctx())).toBe(true);
    }
  });
});

describe('application_tags tab upsert', () => {
  const row = {
    id: UUID,
    application_id: 'app-1',
    user_id: 'guardian-1',
    role: null,
    created_by_user_id: 'admin-1',
    application_key: '2026|1',
    user_key: 'parent@x.test',
  };

  it('refuses a user tag naming someone who is not staff of this school (D50)', async () => {
    const m = { exists: vi.fn().mockResolvedValue(false), save: vi.fn() };
    await expect(
      applicationTagsTab.upsert(row, null, TENANT, m as unknown as EntityManager),
    ).rejects.toThrow('is not staff of this school');
    expect(m.save).not.toHaveBeenCalled();
  });

  it('restores an existing tag unchanged even if its user is no longer staff', async () => {
    const m = { exists: vi.fn().mockResolvedValue(false), save: vi.fn((_e, x) => x) };
    const existing = Object.assign(new ApplicationTag(), { user_id: 'guardian-1' });
    await applicationTagsTab.upsert(row, existing, TENANT, m as unknown as EntityManager);
    expect(m.exists).not.toHaveBeenCalled();
    expect(m.save).toHaveBeenCalledOnce();
  });

  it('checks staff membership in the importing school only', async () => {
    const m = { exists: vi.fn().mockResolvedValue(true), save: vi.fn((_e, x) => x) };
    await applicationTagsTab.upsert(row, null, TENANT, m as unknown as EntityManager);
    expect(m.exists.mock.calls[0][1].where).toMatchObject({
      user_id: 'guardian-1',
      tenant_id: TENANT,
    });
  });

  it('saves a user tag naming a staff member', async () => {
    const m = { exists: vi.fn().mockResolvedValue(true), save: vi.fn((_e, x) => x) };
    await applicationTagsTab.upsert(row, null, TENANT, m as unknown as EntityManager);
    expect(m.save).toHaveBeenCalledOnce();
  });
});

describe('application_attachments tab fromRow', () => {
  const att = {
    id: UUID,
    application: '2026|1',
    file_name: 'a.pdf',
    mime_type: 'application/pdf',
    size_bytes: '10',
    uploaded_by: 'a@x.test',
  };

  it("re-homes another school's storage_key to the importing school, with a warning", () => {
    const warnings: unknown[] = [];
    const r = applicationAttachmentsTab.fromRow(
      { ...att, storage_key: 'tenants/tenant-a/applications/f.pdf' },
      2,
      ctx(warnings),
    );
    expect('row' in r && r.row.storage_key).toBe(`tenants/${TENANT}/applications/f.pdf`);
    expect(warnings).toHaveLength(1);
  });

  it('rejects a key of this school that is not under applications/', () => {
    const r = applicationAttachmentsTab.fromRow(
      { ...att, storage_key: `tenants/${TENANT}/student-documents/f.pdf` },
      2,
      ctx(),
    );
    expect('errors' in r).toBe(true);
  });

  it('rejects a file type or size outside ATTACHMENT_LIMITS (D10)', () => {
    const key = `tenants/${TENANT}/applications/f.pdf`;
    const html = applicationAttachmentsTab.fromRow(
      { ...att, storage_key: key, mime_type: 'text/html' },
      2,
      ctx(),
    );
    const huge = applicationAttachmentsTab.fromRow(
      { ...att, storage_key: key, size_bytes: String(5 * 1024 * 1024 + 1) },
      2,
      ctx(),
    );
    expect('errors' in html && html.errors[0]?.column).toBe('mime_type');
    expect('errors' in huge && huge.errors[0]?.column).toBe('size_bytes');
  });

  it('rejects a key outside tenants/', () => {
    const r = applicationAttachmentsTab.fromRow({ ...att, storage_key: '../etc/passwd' }, 2, ctx());
    expect('errors' in r).toBe(true);
  });
});

describe('application children export and restore', () => {
  it('never deletes application events by absence (append-only timeline)', () => {
    expect(applicationEventsTab.deleteByAbsence).toBe(false);
    expect(applicationTagsTab.deleteByAbsence).toBe(true);
  });

  it('fails the export when a tag author is not an exportable user', async () => {
    vi.spyOn(applicationsTab, 'load').mockResolvedValue([{ id: 'app-1' }] as never);
    vi.spyOn(applicationsTab, 'keyOf').mockReturnValue('2026|1');
    vi.spyOn(usersTab, 'load').mockResolvedValue([{ id: 'staff-1' }] as never);
    vi.spyOn(usersTab, 'keyOf').mockReturnValue('s@x.test');
    const tag = Object.assign(new ApplicationTag(), {
      id: UUID,
      application_id: 'app-1',
      user_id: null,
      created_by_user_id: 'super-admin',
    });
    const m = { find: vi.fn().mockResolvedValue([tag]) };
    await expect(applicationTagsTab.load(TENANT, m as unknown as EntityManager)).rejects.toThrow(
      'not exportable',
    );
  });

  it('fails the export when an attachment uploader is not an exportable user', async () => {
    vi.spyOn(usersTab, 'load').mockResolvedValue([{ id: 'staff-1' }] as never);
    vi.spyOn(usersTab, 'keyOf').mockReturnValue('s@x.test');
    const m = {
      find: vi.fn().mockResolvedValue([{ id: UUID, uploaded_by_user_id: 'super-admin' }]),
    };
    await expect(
      applicationAttachmentsTab.load(TENANT, m as unknown as EntityManager),
    ).rejects.toThrow('uploader that is not exportable');
    m.find.mockResolvedValue([{ id: UUID, uploaded_by_user_id: 'staff-1' }]);
    await expect(
      applicationAttachmentsTab.load(TENANT, m as unknown as EntityManager),
    ).resolves.toHaveLength(1);
  });
});
