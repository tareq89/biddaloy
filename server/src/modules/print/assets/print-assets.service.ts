import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import sharp, { type Metadata } from 'sharp';
import { AuditAction, PrintAssetKind } from '@biddaloy/shared';
import { PrintAsset } from '../entities/print-asset.entity';
import { StorageService } from '../../storage/storage.service';
import { tenantObjectKey } from '../../storage/storage-key';
import { AuditService } from '../../audit/audit.service';
import { sanitizePrintSvg } from './svg-sanitize';
import { sniffFont } from './font-sniff';

const MB = 1024 * 1024;
export const PRINT_ASSET_UPLOAD_LIMIT = 20 * MB;
const ARTWORK_MAX_BYTES = 20 * MB;
const IMAGE_MAX_BYTES = 5 * MB;
const FONT_MAX_BYTES = 5 * MB;
const ARTWORK_MAX_PX = 8000;
const FONT_FAMILY_RE = /^[\p{L}\p{N} -]{1,100}$/u;

const RASTER_EXT: Record<string, { ext: string; contentType: string }> = {
  png: { ext: 'png', contentType: 'image/png' },
  jpeg: { ext: 'jpg', contentType: 'image/jpeg' },
  webp: { ext: 'webp', contentType: 'image/webp' },
};
const FONT_CONTENT_TYPE = { ttf: 'font/ttf', otf: 'font/otf', woff2: 'font/woff2' } as const;
const KEY_CATEGORY: Record<PrintAssetKind, string> = {
  ARTWORK: 'print-artwork',
  IMAGE: 'print-image',
  FONT: 'print-font',
};

interface Prepared {
  bytes: Buffer;
  ext: string;
  contentType: string;
  widthPx: number | null;
  heightPx: number | null;
}

/** [32.2.2] Print asset upload/list/serve/archive. Content is sniffed; the
 * client mimetype is never read. Assets are archived, never deleted —
 * published template versions may reference the object. */
@Injectable()
export class PrintAssetsService {
  constructor(
    @InjectRepository(PrintAsset) private readonly repo: Repository<PrintAsset>,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async sniffRaster(
    buf: Buffer,
    maxBytes: number,
    maxPx: number | null,
  ): Promise<Prepared> {
    if (buf.length > maxBytes) {
      throw new BadRequestException(`Image must be at most ${maxBytes / MB}MB`);
    }
    let meta: Metadata;
    try {
      meta = await sharp(buf).metadata();
    } catch {
      throw new BadRequestException('File is not a readable image');
    }
    const fmt = meta.format ? RASTER_EXT[meta.format] : undefined;
    if (!fmt) throw new BadRequestException('Image must be PNG, JPEG or WebP');
    if (!meta.width || !meta.height) throw new BadRequestException('File is not a readable image');
    if (maxPx && (meta.width > maxPx || meta.height > maxPx)) {
      throw new BadRequestException(`Image dimensions must not exceed ${maxPx}px`);
    }
    // Original bytes kept: the DPI check needs the real pixels.
    return { bytes: buf, ...fmt, widthPx: meta.width, heightPx: meta.height };
  }

  private async prepare(
    kind: PrintAssetKind,
    buf: Buffer,
    fontFamily: string | undefined,
  ): Promise<Prepared> {
    if (kind === PrintAssetKind.FONT) {
      if (buf.length > FONT_MAX_BYTES) {
        throw new BadRequestException(`Font must be at most ${FONT_MAX_BYTES / MB}MB`);
      }
      const ext = sniffFont(buf);
      if (!ext) throw new BadRequestException('Font must be TTF, OTF or WOFF2');
      return {
        bytes: buf,
        ext,
        contentType: FONT_CONTENT_TYPE[ext],
        widthPx: null,
        heightPx: null,
      };
    }
    if (kind === PrintAssetKind.IMAGE) return this.sniffRaster(buf, IMAGE_MAX_BYTES, null);
    // ARTWORK: PNG/JPEG magic first (their metadata may contain "<svg"),
    // then SVG, then any other raster (WebP) via sharp.
    const isPngOrJpeg =
      buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
      buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const head = buf.subarray(0, 512).toString('utf8');
    if (!isPngOrJpeg && (/<svg[\s>]/i.test(head) || /^\s*<\?xml/i.test(head))) {
      const { svg, widthPx, heightPx } = sanitizePrintSvg(buf);
      return {
        bytes: Buffer.from(svg, 'utf8'),
        ext: 'svg',
        contentType: 'image/svg+xml',
        widthPx: widthPx ?? null,
        heightPx: heightPx ?? null,
      };
    }
    return this.sniffRaster(buf, ARTWORK_MAX_BYTES, ARTWORK_MAX_PX);
  }

  async upload(
    tenantId: string,
    userId: string,
    kind: string,
    file: Express.Multer.File,
    fontFamily?: string,
  ): Promise<PrintAsset> {
    if (!file?.buffer) throw new BadRequestException('A file is required');
    if (!Object.values(PrintAssetKind).includes(kind as PrintAssetKind)) {
      throw new BadRequestException('kind must be ARTWORK, IMAGE or FONT');
    }
    const assetKind = kind as PrintAssetKind;
    if (assetKind === PrintAssetKind.FONT && !FONT_FAMILY_RE.test(fontFamily ?? '')) {
      throw new BadRequestException(
        'font_family is required (1-100 letters, digits, spaces or hyphens)',
      );
    }
    const originalName = (file.originalname ?? '').slice(0, 255) || 'upload';

    const p = await this.prepare(assetKind, file.buffer, fontFamily);
    const key = tenantObjectKey(tenantId, KEY_CATEGORY[assetKind], p.ext);
    await this.storage.put(key, p.bytes, p.contentType);

    let saved: PrintAsset;
    try {
      saved = await this.repo.save(
        this.repo.create({
          tenant_id: tenantId,
          asset_kind: assetKind,
          storage_key: key,
          content_type: p.contentType,
          byte_size: p.bytes.length,
          width_px: p.widthPx,
          height_px: p.heightPx,
          font_family: assetKind === PrintAssetKind.FONT ? (fontFamily ?? null) : null,
          original_name: originalName,
          uploaded_by: userId,
        }),
      );
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }

    await this.audit.record({
      action: AuditAction.CREATE,
      entity_type: 'PrintAsset',
      entity_id: saved.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      new_values: { asset_kind: assetKind, content_type: p.contentType, byte_size: p.bytes.length },
    });
    return saved;
  }

  list(tenantId: string, kind?: string): Promise<PrintAsset[]> {
    if (kind !== undefined && !Object.values(PrintAssetKind).includes(kind as PrintAssetKind)) {
      throw new BadRequestException('kind must be ARTWORK, IMAGE or FONT');
    }
    return this.repo.find({
      where: {
        tenant_id: tenantId,
        archived_at: IsNull(),
        ...(kind ? { asset_kind: kind as PrintAssetKind } : {}),
      },
      order: { created_at: 'DESC' },
    });
  }

  /** Tenant-scoped: the id lookup filters on tenant_id, so another tenant's
   * asset is a 404, never a 403. Archived assets still stream — published
   * versions may reference them. */
  async getFile(id: string, tenantId: string) {
    const asset = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!asset) throw new NotFoundException('Print asset not found');
    const object = await this.storage.get(asset.storage_key);
    return { asset, object };
  }

  /** Sets `archived_at` only. The object is never deleted. */
  async archive(id: string, tenantId: string, userId: string): Promise<PrintAsset> {
    const asset = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!asset) throw new NotFoundException('Print asset not found');
    if (asset.archived_at) return asset;
    asset.archived_at = new Date();
    const saved = await this.repo.save(asset);
    await this.audit.record({
      action: AuditAction.UPDATE,
      entity_type: 'PrintAsset',
      entity_id: id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      old_values: { archived_at: null },
      new_values: { archived_at: saved.archived_at },
    });
    return saved;
  }
}
