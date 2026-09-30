import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Not, Repository } from 'typeorm';
import {
  AuditAction,
  DocumentKind,
  PRINT_BATCH_CEILING,
  PrintAssetKind,
  validateTemplateDefinition,
} from '@biddaloy/shared';
import type { TemplateDefinition } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { tenantObjectKey } from '../../storage/storage-key';
import { PrintAsset } from '../entities/print-asset.entity';
import { PrintTemplate } from '../entities/print-template.entity';
import { PrintTemplateVersion } from '../entities/print-template-version.entity';
import {
  ARTWORK_DIR,
  PRINT_SUGGESTIONS,
  type ArtworkSide,
  type PrintSuggestion,
} from '../suggestions/suggestions';
import type {
  CreatePrintTemplateDto,
  ListPrintTemplatesQueryDto,
  UpdatePrintTemplateDto,
} from './dto/print-template.dto';

const PG_UNIQUE_VIOLATION = '23505';
const SIDES: ArtworkSide[] = ['front', 'back'];

const isUniqueViolation = (e: unknown) =>
  (e as { code?: string; driverError?: { code?: string } })?.code === PG_UNIQUE_VIOLATION ||
  (e as { driverError?: { code?: string } })?.driverError?.code === PG_UNIQUE_VIOLATION;

/** [32.2.1] Template CRUD, publish (immutable versions), default and archive. Every query is tenant-scoped; a foreign id is a 404. */
@Injectable()
export class PrintTemplatesService {
  constructor(
    @InjectRepository(PrintTemplate) private readonly templates: Repository<PrintTemplate>,
    @InjectRepository(PrintTemplateVersion)
    private readonly versions: Repository<PrintTemplateVersion>,
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  suggestions() {
    return PRINT_SUGGESTIONS.map(({ key, documentKind, orientation, style, nameKey }) => ({
      key,
      documentKind,
      orientation,
      style,
      nameKey,
    }));
  }

  /** Absolute path of a suggestion's SVG. `key` and `side` are matched against the allowlist, never joined raw. */
  suggestionArtworkPath(key: string, side: string): string {
    const suggestion = PRINT_SUGGESTIONS.find((s) => s.key === key);
    const found = SIDES.find((s) => s === side);
    if (!suggestion || !found) throw new NotFoundException('Suggestion artwork not found');
    return join(ARTWORK_DIR, suggestion.artwork[found]);
  }

  async list(tenantId: string, q: ListPrintTemplatesQueryDto) {
    const rows = await this.templates.find({
      where: {
        tenant_id: tenantId,
        ...(q.document_kind ? { document_kind: q.document_kind } : {}),
        ...(q.include_archived ? {} : { archived_at: IsNull() }),
      },
      order: { name: 'ASC' },
    });
    const versionIds = rows.flatMap((r) => (r.current_version_id ? [r.current_version_id] : []));
    const current = versionIds.length
      ? await this.versions.find({
          select: ['id', 'version', 'published_at'],
          where: { tenant_id: tenantId, id: In(versionIds) },
        })
      : [];
    const byId = new Map(current.map((v) => [v.id, v]));
    return rows.map((r) => {
      const v = r.current_version_id ? byId.get(r.current_version_id) : undefined;
      return {
        id: r.id,
        name: r.name,
        document_kind: r.document_kind,
        layout_kind: r.layout_kind,
        is_default: r.is_default,
        batch_size: r.batch_size,
        // The same pointer the detail response carries, so a list row and a detail row have one shape.
        current_version_id: r.current_version_id,
        current_version: v ? { id: v.id, version: v.version, published_at: v.published_at } : null,
        archived_at: r.archived_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });
  }

  async findOne(tenantId: string, id: string) {
    const template = await this.load(this.templates, tenantId, id);
    const current = template.current_version_id
      ? await this.versions.findOne({
          where: { id: template.current_version_id, tenant_id: tenantId },
        })
      : null;
    return { ...template, current_version: current };
  }

  async create(tenantId: string, userId: string, dto: CreatePrintTemplateDto) {
    const suggestion = PRINT_SUGGESTIONS.find((s) => s.key === dto.suggestion_key);
    if (!suggestion) throw new BadRequestException(`Unknown suggestion "${dto.suggestion_key}"`);

    // Storage first, DB second: a failed transaction leaves at most an unreferenced object.
    const stored = await Promise.all(
      SIDES.map((side) => this.storeArtwork(tenantId, suggestion, side)),
    );

    try {
      return await this.dataSource.transaction(async (manager) => {
        const assets = manager.getRepository(PrintAsset);
        const [front, back] = await Promise.all(
          stored.map((s) =>
            assets.save(assets.create({ ...s, tenant_id: tenantId, uploaded_by: userId })),
          ),
        );
        const draft: TemplateDefinition = structuredClone(suggestion.definition);
        draft.front.background = { assetId: front!.id, print: true };
        draft.back = { ...draft.back!, background: { assetId: back!.id, print: true } };

        const repo = manager.getRepository(PrintTemplate);
        const hasDefault = await repo.exists({
          where: {
            tenant_id: tenantId,
            document_kind: suggestion.documentKind,
            is_default: true,
            archived_at: IsNull(),
          },
        });
        const template = await repo.save(
          repo.create({
            tenant_id: tenantId,
            document_kind: suggestion.documentKind,
            name: dto.name,
            is_default: !hasDefault,
            draft,
            created_by: userId,
          }),
        );
        await this.audit.record(
          {
            action: AuditAction.CREATE,
            entity_type: 'PrintTemplate',
            entity_id: template.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            new_values: { name: template.name, suggestion_key: suggestion.key },
          },
          manager,
        );
        return template;
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('A template with this name already exists');
      }
      throw e;
    }
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdatePrintTemplateDto) {
    if (
      dto.batch_size !== undefined &&
      (!Number.isInteger(dto.batch_size) ||
        dto.batch_size < 1 ||
        dto.batch_size > PRINT_BATCH_CEILING)
    ) {
      throw new BadRequestException(`batch_size must be 1..${PRINT_BATCH_CEILING}`);
    }
    try {
      return await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(PrintTemplate);
        const template = await this.load(repo, tenantId, id);
        this.assertActive(template);
        if (dto.draft !== undefined) {
          template.draft = await this.validateDraft(
            manager,
            tenantId,
            template.document_kind,
            dto.draft,
          );
        }
        if (dto.name !== undefined) template.name = dto.name;
        if (dto.batch_size !== undefined) template.batch_size = dto.batch_size;
        const saved = await repo.save(template);
        await this.audit.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'PrintTemplate',
            entity_id: id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            new_values: {
              ...(dto.name !== undefined && { name: dto.name }),
              ...(dto.batch_size !== undefined && { batch_size: dto.batch_size }),
              ...(dto.draft !== undefined && { draft_updated: true }),
            },
          },
          manager,
        );
        return saved;
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('A template with this name already exists');
      }
      throw e;
    }
  }

  async publish(tenantId: string, userId: string, id: string) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PrintTemplate);
      const template = await this.load(repo, tenantId, id, true);
      this.assertActive(template);
      const definition = await this.validateDraft(
        manager,
        tenantId,
        template.document_kind,
        template.draft,
      );
      const versions = manager.getRepository(PrintTemplateVersion);
      const next = ((await versions.maximum('version', { template_id: id })) ?? 0) + 1;
      const version = await versions.save(
        versions.create({
          tenant_id: tenantId,
          template_id: id,
          version: next,
          definition,
          published_by: userId,
        }),
      );
      template.current_version_id = version.id;
      await repo.save(template);
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'PrintTemplate',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          new_values: { version: next },
        },
        manager,
      );
      return { id: version.id, version: next, published_at: version.published_at };
    });
  }

  async setDefault(tenantId: string, userId: string, id: string) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PrintTemplate);
      const template = await this.load(repo, tenantId, id, true);
      this.assertActive(template);
      if (!template.current_version_id) {
        throw new ConflictException('Publish the template before making it the default');
      }
      await repo.update(
        { tenant_id: tenantId, document_kind: template.document_kind, is_default: true },
        { is_default: false },
      );
      template.is_default = true;
      const saved = await repo.save(template);
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'PrintTemplate',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          new_values: { is_default: true },
        },
        manager,
      );
      return saved;
    });
  }

  async archive(tenantId: string, userId: string, id: string) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PrintTemplate);
      const template = await this.load(repo, tenantId, id, true);
      if (template.archived_at) return template;
      if (template.is_default) {
        const others = await repo.count({
          where: {
            tenant_id: tenantId,
            document_kind: template.document_kind,
            archived_at: IsNull(),
            id: Not(id),
          },
        });
        if (others > 0) {
          throw new ConflictException('Choose another default first');
        }
      }
      template.archived_at = new Date();
      template.is_default = false;
      const saved = await repo.save(template);
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'PrintTemplate',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          new_values: { archived: true },
        },
        manager,
      );
      return saved;
    });
  }

  async listVersions(tenantId: string, templateId: string) {
    await this.load(this.templates, tenantId, templateId);
    return this.versions.find({
      select: ['id', 'version', 'published_by', 'published_at'],
      where: { tenant_id: tenantId, template_id: templateId },
      order: { version: 'DESC' },
    });
  }

  async findVersion(tenantId: string, versionId: string) {
    const version = await this.versions.findOne({ where: { id: versionId, tenant_id: tenantId } });
    if (!version) throw new NotFoundException('Template version not found');
    return version;
  }

  private async load(repo: Repository<PrintTemplate>, tenantId: string, id: string, lock = false) {
    const template = await repo.findOne({
      where: { id, tenant_id: tenantId },
      ...(lock && { lock: { mode: 'pessimistic_write' as const } }),
    });
    if (!template) throw new NotFoundException('Print template not found');
    return template;
  }

  private assertActive(template: PrintTemplate) {
    if (template.archived_at) throw new ConflictException('Print template is archived');
  }

  private async storeArtwork(tenantId: string, suggestion: PrintSuggestion, side: ArtworkSide) {
    const file = suggestion.artwork[side];
    const body = await readFile(join(ARTWORK_DIR, file));
    // ponytail: tenantObjectKey has no 'svg' in its extension allowlist (storage-key.ts is outside
    // this ticket's territory); build with 'png' to reuse its tenant/category validation, then swap.
    const storage_key = tenantObjectKey(tenantId, 'print-artwork', 'png').replace(/\.png$/, '.svg');
    await this.storage.put(storage_key, body, 'image/svg+xml');
    return {
      asset_kind: PrintAssetKind.ARTWORK,
      storage_key,
      content_type: 'image/svg+xml',
      byte_size: body.length,
      original_name: file,
    };
  }

  /** Shared schema + no stripped (unknown) fields (D29) + every referenced asset is a live asset of this tenant. */
  private async validateDraft(
    manager: EntityManager,
    tenantId: string,
    kind: DocumentKind,
    draft: unknown,
  ): Promise<TemplateDefinition> {
    const result = validateTemplateDefinition(draft, kind);
    if (!result.success)
      throw new BadRequestException({ message: 'Invalid draft', errors: result.errors });
    // Zod strips unknown keys; if parsing changed anything, the draft carried a field we don't know.
    if (!isDeepStrictEqual(result.data, JSON.parse(JSON.stringify(draft)))) {
      throw new BadRequestException('Draft contains unknown fields');
    }
    const def = result.data;
    const ids = new Set<string>();
    for (const side of [def.front, def.back]) {
      if (!side) continue;
      if (side.background) ids.add(side.background.assetId);
      for (const el of side.elements) {
        if (el.type === 'IMAGE' && el.assetId) ids.add(el.assetId);
        if (el.type === 'TEXT' && el.fontAssetId) ids.add(el.fontAssetId);
      }
    }
    if (ids.size) {
      const live = await manager.getRepository(PrintAsset).count({
        where: { tenant_id: tenantId, id: In([...ids]), archived_at: IsNull() },
      });
      if (live !== ids.size) {
        throw new BadRequestException('Draft references an unknown or archived asset');
      }
    }
    return def;
  }
}
