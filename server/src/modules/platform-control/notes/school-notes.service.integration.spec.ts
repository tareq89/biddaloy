import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AuditAction, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { School } from '../../schools/entities/school.entity';
import { PlatformSchoolNote } from '../../support-access/entities/platform-school-note.entity';
import { User } from '../../users/entities/user.entity';
import { SchoolNotesService } from './school-notes.service';

const context = { ip: '127.0.0.1', userAgent: 'vitest' };

describe('SchoolNotesService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let service: SchoolNotesService;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [SchoolNotesService, AuditService]);
    ds = module.get(DataSource);
    service = module.get(SchoolNotesService);
  });

  afterAll(async () => {
    await module?.close();
  });

  const sfx = () => randomUUID().slice(0, 8);
  const school = (s = sfx()) =>
    ds
      .getRepository(School)
      .save(ds.getRepository(School).create({ name: `S ${s}`, slug: `s-${s}` }));
  const owner = () =>
    ds
      .getRepository(User)
      .save(ds.getRepository(User).create({ full_name: `O ${sfx()}`, status: UserStatus.ACTIVE }));
  const auditRows = (tenantId: string) =>
    ds
      .getRepository(AuditLog)
      .find({ where: { tenant_id: tenantId, action: AuditAction.PLATFORM_SCHOOL_NOTE_ADDED } });

  it('notes of school A never appear under school B, newest first, trimmed', async () => {
    const a = await school();
    const b = await school();
    const o = await owner();
    await service.add(a.id, '  first  ', o.id, context);
    await service.add(a.id, 'second', o.id, context);
    await service.add(b.id, 'other school', o.id, context);

    const listA = await service.list(a.id);
    expect(listA.map((n) => n.text)).toEqual(['second', 'first']);
    expect(listA[0].authorId).toBe(o.id);
    expect((await service.list(b.id)).map((n) => n.text)).toEqual(['other school']);
    expect(await service.list(a.id, 1)).toHaveLength(1);
  });

  it('the audit row carries the school tenant id, note id and length, and no text', async () => {
    const a = await school();
    const o = await owner();
    const note = await service.add(a.id, 'very private words', o.id, context);

    const [row] = await auditRows(a.id);
    expect(row.entity_id).toBe(note.id);
    expect(row.performed_by_user_id).toBe(o.id);
    expect(row.new_values).toEqual({ noteId: note.id, length: 18 });
    // The school can read its own audit rows: the text must be nowhere in one.
    expect(JSON.stringify(row)).not.toContain('private');
  });

  it('delete removes the note, audits deleted=true without text, keeps the add row', async () => {
    const a = await school();
    const o = await owner();
    const note = await service.add(a.id, 'to be removed', o.id, context);
    await service.remove(a.id, note.id, o.id, context);

    expect(await service.list(a.id)).toEqual([]);
    const rows = await auditRows(a.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.new_values)).toContainEqual({
      noteId: note.id,
      length: 13,
      deleted: true,
    });
    expect(JSON.stringify(rows)).not.toContain('removed');
  });

  it('deleting another school’s note is 404 and the note survives', async () => {
    const a = await school();
    const b = await school();
    const o = await owner();
    const note = await service.add(a.id, 'mine', o.id, context);
    await expect(service.remove(b.id, note.id, o.id, context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await ds.getRepository(PlatformSchoolNote).countBy({ id: note.id })).toBe(1);
    expect(await auditRows(b.id)).toHaveLength(0);
  });

  it('an unknown school is 404 on list, add and remove, and writes nothing', async () => {
    const o = await owner();
    const ghost = randomUUID();
    await expect(service.list(ghost)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.add(ghost, 'x', o.id, context)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(ghost, randomUUID(), o.id, context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await ds.getRepository(PlatformSchoolNote).countBy({ tenant_id: ghost })).toBe(0);
  });
});
