import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole } from '@biddaloy/shared';
import { StudentNotesService } from './student-notes.service';
import { CreateStudentNoteDto } from './dto/student-notes.dto';

const TENANT = 't1';
const STUDENT = 's1';

async function bodyErrors(body: unknown) {
  const dto = plainToInstance(CreateStudentNoteDto, { body });
  return { dto, errors: await validate(dto) };
}

describe('CreateStudentNoteDto', () => {
  it('trims and accepts 1..2000 chars', async () => {
    const { dto, errors } = await bodyErrors('  hi  ');
    expect(errors).toHaveLength(0);
    expect(dto.body).toBe('hi');
    expect((await bodyErrors('x'.repeat(2000))).errors).toHaveLength(0);
  });

  it('rejects empty, whitespace-only, >2000 and non-string bodies', async () => {
    for (const bad of ['', '   ', 'x'.repeat(2001), 5, undefined]) {
      expect((await bodyErrors(bad)).errors.length).toBeGreaterThan(0);
    }
  });

  it('strips HTML markup, and a markup-only body is rejected as blank (CWE-79)', async () => {
    const { dto, errors } = await bodyErrors('  <b>ok</b><script>alert(1)</script> ');
    expect(errors).toHaveLength(0);
    expect(dto.body).not.toMatch(/[<>]/);
    expect(dto.body).toContain('ok');
    expect((await bodyErrors('<b> </b>')).errors.length).toBeGreaterThan(0);
  });
});

describe('StudentNotesService', () => {
  const note = { id: 'n1', student_id: STUDENT, tenant_id: TENANT, author_user_id: 'author' };
  let notes: { findOne: any; softDelete: any; save: any; create: any };
  let students: { findOne: any };
  let dataSource: { query: any };
  let audit: { record: any };
  let service: StudentNotesService;

  beforeEach(() => {
    notes = {
      findOne: vi.fn().mockResolvedValue(note),
      softDelete: vi.fn().mockResolvedValue(undefined),
      create: vi.fn((x) => x),
      save: vi.fn(async (x) => ({ ...x, id: 'n2', created_at: new Date() })),
    };
    students = { findOne: vi.fn().mockResolvedValue({ id: STUDENT, class_section_id: 'sec' }) };
    dataSource = { query: vi.fn().mockResolvedValue([{ full_name: 'Ann' }]) };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    service = new StudentNotesService(
      notes as any,
      students as any,
      dataSource as any,
      audit as any,
    );
  });

  const caller = (userId: string, role: string) => ({ userId, role, tenantId: TENANT });

  it('lets the author delete, soft-deletes tenant-scoped, and audits', async () => {
    await service.remove(STUDENT, 'n1', caller('author', UserRole.TEACHER));
    // teacher section check ran, then the delete
    expect(notes.softDelete).toHaveBeenCalledWith({ id: 'n1', tenant_id: TENANT });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('lets an ADMIN delete someone else’s note', async () => {
    await service.remove(STUDENT, 'n1', caller('admin', UserRole.ADMIN));
    expect(notes.softDelete).toHaveBeenCalled();
  });

  it('forbids a non-author non-admin (EXECUTIVE) from deleting', async () => {
    await expect(
      service.remove(STUDENT, 'n1', caller('other', UserRole.EXECUTIVE)),
    ).rejects.toThrow(ForbiddenException);
    expect(notes.softDelete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('404s when the note is not found in this tenant/student', async () => {
    notes.findOne.mockResolvedValue(null);
    await expect(service.remove(STUDENT, 'n1', caller('admin', UserRole.ADMIN))).rejects.toThrow(
      NotFoundException,
    );
    expect(notes.findOne.mock.calls[0][0].where).toMatchObject({ tenant_id: TENANT });
  });

  it('forbids a TEACHER with no section mapping', async () => {
    dataSource.query.mockResolvedValue([]);
    await expect(service.list(STUDENT, caller('t', UserRole.TEACHER))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('create stores the author, tenant and audits without the body', async () => {
    const res = await service.create(STUDENT, { body: 'hello' }, caller('u1', UserRole.ADMIN));
    expect(notes.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: TENANT, author_user_id: 'u1', student_id: STUDENT }),
    );
    expect(res.author).toEqual({ id: 'u1', name: 'Ann' });
    expect(JSON.stringify(audit.record.mock.calls[0][0])).not.toContain('hello');
  });
});
