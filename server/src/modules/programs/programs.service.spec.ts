import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProgramsService } from './programs.service';

function fakeManager(repos: Record<string, any>) {
  return {
    getRepository: vi.fn((entity: any) => repos[entity?.name] ?? repos.Program),
  };
}

describe('ProgramsService', () => {
  let programRepo: any;
  let milestoneRepo: any;
  let enrollmentRepo: any;
  let achievementRepo: any;
  let dataSource: any;
  let auditService: any;
  let service: ProgramsService;

  const TENANT = 'tenant-1';
  const OTHER_TENANT = 'tenant-2';

  beforeEach(() => {
    programRepo = {
      find: vi.fn(async () => []),
      findOne: vi.fn(),
      create: vi.fn((v: any) => v),
      save: vi.fn(async (v: any) => ({ id: 'program-1', ...v })),
      update: vi.fn(async () => ({ affected: 1 })),
      delete: vi.fn(async () => ({ affected: 1 })),
    };
    milestoneRepo = {
      find: vi.fn(async () => []),
      findOne: vi.fn(),
      count: vi.fn(async () => 0),
      create: vi.fn((v: any) => v),
      save: vi.fn(async (v: any) => ({ id: 'milestone-1', ...v })),
      update: vi.fn(async () => ({ affected: 1 })),
      delete: vi.fn(async () => ({ affected: 1 })),
    };
    enrollmentRepo = { count: vi.fn(async () => 0) };
    achievementRepo = { count: vi.fn(async () => 0) };
    auditService = { record: vi.fn() };
    dataSource = {
      transaction: vi.fn(async (cb: any) =>
        cb(
          fakeManager({
            Program: programRepo,
            ProgramMilestone: milestoneRepo,
          }),
        ),
      ),
    };

    service = new ProgramsService(
      programRepo,
      milestoneRepo,
      enrollmentRepo,
      achievementRepo,
      dataSource,
      auditService,
    );
  });

  describe('create/update', () => {
    it('creates and audits a new program', async () => {
      const program = await service.create(TENANT, 'user-1', { name: 'Hifz Track' });
      expect(program.name).toBe('Hifz Track');
      expect(auditService.record).toHaveBeenCalledTimes(1);
    });

    it('updates a program and audits the change', async () => {
      const existingProgram = {
        id: 'program-1',
        tenant_id: TENANT,
        name: 'Old',
        description: null,
        is_active: true,
        show_on_report_card: false,
      };
      programRepo.findOne
        .mockResolvedValueOnce(existingProgram)
        // Second call is the duplicate-name check (findOne by name) — no
        // other program has this name.
        .mockResolvedValueOnce(null)
        // Third call is the final re-read `update()` returns.
        .mockResolvedValueOnce({ ...existingProgram, name: 'New' });
      await service.update('program-1', TENANT, 'user-1', { name: 'New' });
      expect(programRepo.update).toHaveBeenCalledWith(
        { id: 'program-1', tenant_id: TENANT },
        { name: 'New' },
      );
      expect(auditService.record).toHaveBeenCalledTimes(1);
    });

    it('refuses a duplicate program name with a 409', async () => {
      programRepo.findOne.mockResolvedValueOnce({ id: 'program-2', name: 'Hifz Track' });
      await expect(service.create(TENANT, 'user-1', { name: 'Hifz Track' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(programRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('sets is_active to false', async () => {
      programRepo.findOne.mockResolvedValue({
        id: 'program-1',
        tenant_id: TENANT,
        name: 'P',
        description: null,
        is_active: true,
        show_on_report_card: false,
      });
      await service.archive('program-1', TENANT, 'user-1');
      expect(programRepo.update).toHaveBeenCalledWith(
        { id: 'program-1', tenant_id: TENANT },
        { is_active: false },
      );
    });
  });

  describe('remove (D23)', () => {
    it('blocks delete with a 409 naming the enrolment count', async () => {
      programRepo.findOne.mockResolvedValue({ id: 'program-1', tenant_id: TENANT, name: 'P' });
      enrollmentRepo.count.mockResolvedValue(3);
      await expect(service.remove('program-1', TENANT, 'user-1')).rejects.toThrow(
        'Program has 3 enrolments; archive it instead',
      );
      expect(programRepo.delete).not.toHaveBeenCalled();
    });

    it('hard-deletes when there are zero enrolments (milestones cascade by FK)', async () => {
      programRepo.findOne.mockResolvedValue({ id: 'program-1', tenant_id: TENANT, name: 'P' });
      enrollmentRepo.count.mockResolvedValue(0);
      await service.remove('program-1', TENANT, 'user-1');
      expect(programRepo.delete).toHaveBeenCalledWith({ id: 'program-1', tenant_id: TENANT });
      expect(auditService.record).toHaveBeenCalledTimes(1);
    });

    it("404s on another tenant's program id", async () => {
      programRepo.findOne.mockResolvedValue(null);
      await expect(service.remove('program-1', OTHER_TENANT, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('milestones', () => {
    it('appends a milestone at max(sequence)+1', async () => {
      programRepo.findOne.mockResolvedValue({ id: 'program-1', tenant_id: TENANT, name: 'P' });
      milestoneRepo.find.mockResolvedValueOnce([{ id: 'm1', sequence: 3 }]);
      const milestone = await service.addMilestone('program-1', TENANT, 'user-1', {
        name: 'Juz 1',
      });
      expect(milestone.sequence).toBe(4);
    });

    it('starts at sequence 1 for the first milestone', async () => {
      programRepo.findOne.mockResolvedValue({ id: 'program-1', tenant_id: TENANT, name: 'P' });
      milestoneRepo.find.mockResolvedValueOnce([]);
      const milestone = await service.addMilestone('program-1', TENANT, 'user-1', {
        name: 'Juz 1',
      });
      expect(milestone.sequence).toBe(1);
    });

    it('removeMilestone reports the achievement count before delete', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        program_id: 'program-1',
        tenant_id: TENANT,
        name: 'Juz 1',
      });
      programRepo.findOne.mockResolvedValue({ id: 'program-1', tenant_id: TENANT });
      achievementRepo.count.mockResolvedValueOnce(5);
      const result = await service.removeMilestone('program-1', 'm1', TENANT, 'user-1');
      expect(result).toEqual({ achievements_removed: 5 });
      expect(milestoneRepo.delete).toHaveBeenCalledWith({ id: 'm1', tenant_id: TENANT });
    });

    it("every milestone method 404s on another tenant's milestone id", async () => {
      programRepo.findOne.mockResolvedValue({ id: 'program-1', tenant_id: OTHER_TENANT });
      milestoneRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateMilestone('program-1', 'm1', OTHER_TENANT, 'user-1', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('findMilestonesWithAchievementCounts pairs each milestone with its count, defaulting to 0', async () => {
      milestoneRepo.find.mockResolvedValueOnce([
        { id: 'm1', sequence: 1 },
        { id: 'm2', sequence: 2 },
      ]);
      const getRawMany = vi.fn().mockResolvedValue([{ milestone_id: 'm1', count: '3' }]);
      const qb = {
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        getRawMany,
      };
      achievementRepo.createQueryBuilder = vi.fn(() => qb);

      const rows = await service.findMilestonesWithAchievementCounts('program-1', TENANT);
      expect(rows).toEqual([
        { milestone: { id: 'm1', sequence: 1 }, achievement_count: 3 },
        { milestone: { id: 'm2', sequence: 2 }, achievement_count: 0 },
      ]);
    });
  });

  describe('reorder', () => {
    const milestones = [
      { id: 'm1', sequence: 1 },
      { id: 'm2', sequence: 2 },
      { id: 'm3', sequence: 3 },
    ];

    beforeEach(() => {
      programRepo.findOne.mockResolvedValue({ id: 'program-1', tenant_id: TENANT });
      milestoneRepo.find.mockResolvedValue(milestones);
    });

    it('rejects a wrong id set', async () => {
      await expect(
        service.reorder('program-1', TENANT, 'user-1', ['m1', 'm2', 'unknown-id']),
      ).rejects.toThrow(ConflictException);
      expect(milestoneRepo.update).not.toHaveBeenCalled();
    });

    it('rejects a set missing an id', async () => {
      await expect(service.reorder('program-1', TENANT, 'user-1', ['m1', 'm2'])).rejects.toThrow(
        ConflictException,
      );
    });

    it('swaps sequences in the requested order', async () => {
      await service.reorder('program-1', TENANT, 'user-1', ['m3', 'm1', 'm2']);
      expect(milestoneRepo.update).toHaveBeenCalledWith(
        { id: 'm3', tenant_id: TENANT },
        { sequence: 1 },
      );
      expect(milestoneRepo.update).toHaveBeenCalledWith(
        { id: 'm1', tenant_id: TENANT },
        { sequence: 2 },
      );
      expect(milestoneRepo.update).toHaveBeenCalledWith(
        { id: 'm2', tenant_id: TENANT },
        { sequence: 3 },
      );
    });
  });
});
