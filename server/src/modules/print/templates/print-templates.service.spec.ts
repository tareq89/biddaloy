import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DocumentKind } from '@biddaloy/shared';
import { PRINT_SUGGESTIONS } from '../suggestions/suggestions';
import { PrintTemplatesService } from './print-templates.service';
import { PrintAsset } from '../entities/print-asset.entity';
import { PrintTemplate } from '../entities/print-template.entity';
import { PrintTemplateVersion } from '../entities/print-template-version.entity';

const TENANT = '00000000-0000-4000-8000-0000000000a1';
const USER = '00000000-0000-4000-8000-0000000000b1';
const ID = '00000000-0000-4000-8000-0000000000c1';
const SUGGESTION = PRINT_SUGGESTIONS[0]!;

function setup(template: Partial<PrintTemplate> | null = {}) {
  const tpl = template && {
    id: ID,
    tenant_id: TENANT,
    document_kind: DocumentKind.STUDENT_ID_CARD,
    name: 'T',
    is_default: false,
    batch_size: 50,
    draft: structuredClone(SUGGESTION.definition),
    current_version_id: null,
    archived_at: null,
    ...template,
  };
  const saved: PrintTemplateVersion[] = [];
  let max: number | null = null;
  const templateRepo = {
    findOne: vi.fn(async () => tpl),
    save: vi.fn(async (t) => t),
    update: vi.fn(async () => undefined),
    count: vi.fn(async () => 0),
  };
  const versionRepo = {
    maximum: vi.fn(async () => max),
    create: vi.fn((v) => ({ ...v, id: `v${v.version}`, published_at: new Date() })),
    save: vi.fn(async (v) => {
      saved.push(v);
      max = v.version;
      return v;
    }),
  };
  const assetRepo = { count: vi.fn(async () => 1) };
  const manager = {
    getRepository: vi.fn((e: unknown) =>
      e === PrintTemplate ? templateRepo : e === PrintTemplateVersion ? versionRepo : assetRepo,
    ),
  };
  const dataSource = { transaction: vi.fn((cb) => cb(manager)) };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new PrintTemplatesService(
    templateRepo as never,
    versionRepo as never,
    dataSource as never,
    { put: vi.fn() } as never,
    audit as never,
  );
  return { service, tpl, templateRepo, versionRepo, assetRepo, dataSource, audit, saved };
}

describe('PrintTemplatesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('publish increments the version and leaves the old version untouched', async () => {
    const { service, tpl, saved, audit } = setup();
    const first = await service.publish(TENANT, USER, ID);
    const snapshot = structuredClone(saved[0]);
    tpl!.draft.copyLabel = { text: 'Edited' };
    const second = await service.publish(TENANT, USER, ID);
    expect([first.version, second.version]).toEqual([1, 2]);
    expect(saved[0]).toEqual(snapshot);
    expect(saved[0]!.definition.copyLabel).toEqual({ text: 'Copy {n}' });
    expect(tpl!.current_version_id).toBe('v2');
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ new_values: { version: 2 } }),
      expect.anything(),
    );
  });

  it('returns 404 for a template that is not in the tenant', async () => {
    const { service } = setup(null);
    await expect(service.publish(TENANT, USER, ID)).rejects.toThrow(NotFoundException);
  });

  describe('update', () => {
    it('rejects an unknown field in the draft (D29)', async () => {
      const { service } = setup();
      const draft = structuredClone(SUGGESTION.definition) as Record<string, unknown>;
      draft.bogus = 1;
      await expect(service.update(TENANT, USER, ID, { draft })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an asset that is not a live asset of this tenant', async () => {
      const { service, assetRepo } = setup();
      assetRepo.count.mockResolvedValue(0);
      await expect(
        service.update(TENANT, USER, ID, { draft: SUGGESTION.definition as never }),
      ).rejects.toThrow(/asset/);
    });

    it('rejects batch_size 201', async () => {
      const { service } = setup();
      await expect(service.update(TENANT, USER, ID, { batch_size: 201 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('accepts a valid draft and batch_size 200', async () => {
      const { service, templateRepo } = setup();
      await service.update(TENANT, USER, ID, {
        batch_size: 200,
        draft: SUGGESTION.definition as never,
      });
      expect(templateRepo.save).toHaveBeenCalledWith(expect.objectContaining({ batch_size: 200 }));
    });
  });

  describe('setDefault', () => {
    it('unsets the old default and sets the new one inside one transaction', async () => {
      const { service, templateRepo, dataSource } = setup({ current_version_id: 'v1' });
      const saved = await service.setDefault(TENANT, USER, ID);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(templateRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ tenant_id: TENANT, is_default: true }),
        { is_default: false },
      );
      expect(saved.is_default).toBe(true);
    });

    it('409 when there is no published version', async () => {
      const { service } = setup();
      await expect(service.setDefault(TENANT, USER, ID)).rejects.toThrow(ConflictException);
    });
  });

  describe('archive', () => {
    it('allows archiving the only default', async () => {
      const { service } = setup({ is_default: true });
      const t = await service.archive(TENANT, USER, ID);
      expect(t.archived_at).toBeInstanceOf(Date);
      expect(t.is_default).toBe(false);
    });

    it('409 when archiving the default while other active templates exist', async () => {
      const { service, templateRepo } = setup({ is_default: true });
      templateRepo.count.mockResolvedValue(1);
      await expect(service.archive(TENANT, USER, ID)).rejects.toThrow(/another default/);
    });
  });

  describe('suggestionArtworkPath', () => {
    it('only resolves allowlisted key and side', () => {
      const { service } = setup();
      expect(service.suggestionArtworkPath(SUGGESTION.key, 'front')).toMatch(/-front\.svg$/);
      expect(() => service.suggestionArtworkPath('../../etc/passwd', 'front')).toThrow(
        NotFoundException,
      );
      expect(() => service.suggestionArtworkPath(SUGGESTION.key, '../x')).toThrow(
        NotFoundException,
      );
    });
  });

  it('PrintAsset is the asset entity used for validation', () => {
    expect(PrintAsset.name).toBe('PrintAsset');
  });
});
