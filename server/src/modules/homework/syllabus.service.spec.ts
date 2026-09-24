import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SyllabusService } from './syllabus.service';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { Class } from '../academics/entities/class.entity';
import { Subject } from '../academics/entities/subject.entity';
import { AuditService } from '../audit/audit.service';
import { SyllabusTopicStatus } from '@biddaloy/shared';

/**
 * Unit tests for [22.3.4]'s `SyllabusService`: create, reorder, edit
 * status, delete — plus the tenant IDOR guard on class_id/subject_id.
 */

const TENANT_ID = 'tenant-1';

function topic(overrides: Partial<SyllabusTopic> = {}): SyllabusTopic {
  return {
    id: 'topic-1',
    tenant_id: TENANT_ID,
    class_id: 'class-1',
    subject_id: 'subj-1',
    name: 'Algebra basics',
    description: null,
    sequence: 1,
    status: SyllabusTopicStatus.PLANNED,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as SyllabusTopic;
}

function createRepoStub(existing: SyllabusTopic[] = []) {
  const repo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: `id-${Math.random()}`, ...v })),
    update: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    find: vi.fn(async () => existing),
    findOne: vi.fn(async ({ where }: any) => existing.find((t) => t.id === where.id) ?? null),
    createQueryBuilder: vi.fn(() => {
      const qb: any = {
        where: vi.fn(() => qb),
        andWhere: vi.fn(() => qb),
        orderBy: vi.fn(() => qb),
        getMany: vi.fn(async () => existing),
      };
      return qb;
    }),
  };
  repo.manager = {
    transaction: vi.fn(async (cb: any) => cb({ getRepository: () => repo })),
  };
  return repo;
}

async function buildService(existing: SyllabusTopic[] = []) {
  const topicRepo = createRepoStub(existing);
  const classRepo: any = {
    findOne: vi.fn(async ({ where }: any) => ({ id: where.id, tenant_id: where.tenant_id })),
  };
  const subjectRepo: any = {
    findOne: vi.fn(async ({ where }: any) => ({ id: where.id, tenant_id: where.tenant_id })),
  };
  const auditService = { record: vi.fn(async () => undefined) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      SyllabusService,
      { provide: getRepositoryToken(SyllabusTopic), useValue: topicRepo },
      { provide: getRepositoryToken(Class), useValue: classRepo },
      { provide: getRepositoryToken(Subject), useValue: subjectRepo },
      { provide: AuditService, useValue: auditService },
    ],
  }).compile();

  return {
    service: moduleRef.get(SyllabusService),
    topicRepo,
    classRepo,
    subjectRepo,
    auditService,
  };
}

describe('SyllabusService', () => {
  it('creates a topic with default status PLANNED', async () => {
    const { service, topicRepo } = await buildService([]);

    const created = await service.create(
      { class_id: 'class-1', subject_id: 'subj-1', name: 'Algebra basics', sequence: 1 } as any,
      TENANT_ID,
    );

    expect(created).toMatchObject({
      name: 'Algebra basics',
      tenant_id: TENANT_ID,
      status: SyllabusTopicStatus.PLANNED,
    });
    expect(topicRepo.save).toHaveBeenCalled();
  });

  it('rejects a create when class does not belong to this tenant', async () => {
    const { service, classRepo } = await buildService([]);
    classRepo.findOne.mockResolvedValueOnce(null);

    await expect(
      service.create(
        { class_id: 'class-x', subject_id: 'subj-1', name: 'X', sequence: 1 } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('edits a topic status', async () => {
    const existing = topic();
    const { service, topicRepo } = await buildService([existing]);

    await service.update(existing.id, { status: SyllabusTopicStatus.DONE } as any, TENANT_ID);

    expect(topicRepo.update).toHaveBeenCalledWith(
      { id: existing.id, tenant_id: TENANT_ID },
      { status: SyllabusTopicStatus.DONE },
    );
  });

  it('throws NotFoundException editing a topic that does not exist', async () => {
    const { service } = await buildService([]);

    await expect(
      service.update('missing', { status: SyllabusTopicStatus.DONE } as any, TENANT_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('deletes a topic', async () => {
    const existing = topic();
    const { service, topicRepo } = await buildService([existing]);

    await service.remove(existing.id, TENANT_ID);

    expect(topicRepo.delete).toHaveBeenCalledWith({ id: existing.id, tenant_id: TENANT_ID });
  });

  it('reorders a set of topics by bulk-updating sequence', async () => {
    const a = topic({ id: 'a', sequence: 1 });
    const b = topic({ id: 'b', sequence: 2 });
    const { service, topicRepo } = await buildService([a, b]);

    await service.reorder(
      [
        { id: 'a', sequence: 2 },
        { id: 'b', sequence: 1 },
      ],
      TENANT_ID,
    );

    expect(topicRepo.update).toHaveBeenCalledWith(
      { id: 'a', tenant_id: TENANT_ID },
      { sequence: 2 },
    );
    expect(topicRepo.update).toHaveBeenCalledWith(
      { id: 'b', tenant_id: TENANT_ID },
      { sequence: 1 },
    );
  });

  it('rejects reorder with a duplicate id', async () => {
    const { service } = await buildService([]);

    await expect(
      service.reorder(
        [
          { id: 'a', sequence: 1 },
          { id: 'a', sequence: 2 },
        ],
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects reorder referencing an id outside this tenant', async () => {
    const a = topic({ id: 'a' });
    const { service } = await buildService([a]);

    await expect(service.reorder([{ id: 'not-mine', sequence: 1 }], TENANT_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});
