import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Logger } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { DocumentKind, PrintAssetKind, validateTemplateDefinition } from '@biddaloy/shared';
import type { PresetCertificateKind, TemplateDefinition } from '@biddaloy/shared';
import { tenantObjectKey } from '../../../storage/storage-key';
import { PrintAsset } from '../../../print/entities/print-asset.entity';
import { PrintTemplate } from '../../../print/entities/print-template.entity';
import { PrintTemplateVersion } from '../../../print/entities/print-template-version.entity';
import {
  ARTWORK_DIR,
  PRINT_SUGGESTIONS,
  type ArtworkSide,
} from '../../../print/suggestions/suggestions';
import type { ApplyWriter } from '../apply-context';

type Lang = 'bn' | 'en';

/** Pack kind -> Epic 48 kind, suggestion slug and the two fixed names. TRANSCRIPT is code-rendered: no entry. */
const CERTS: Partial<
  Record<PresetCertificateKind, { kind: DocumentKind; slug: string; names: Record<Lang, string> }>
> = {
  TRANSFER: {
    kind: DocumentKind.TRANSFER_CERTIFICATE,
    slug: 'tc',
    names: { bn: 'ছাড়পত্র (বাংলা)', en: 'Transfer certificate (English)' },
  },
  TESTIMONIAL: {
    kind: DocumentKind.TESTIMONIAL,
    slug: 'testimonial',
    names: { bn: 'প্রশংসাপত্র (বাংলা)', en: 'Testimonial (English)' },
  },
  CHARACTER: {
    kind: DocumentKind.CHARACTER_CERTIFICATE,
    slug: 'character',
    names: { bn: 'চারিত্রিক সনদপত্র (বাংলা)', en: 'Character certificate (English)' },
  },
};

const SIDES: ArtworkSide[] = ['front', 'back'];
const logger = new Logger('PresetCertificatesWriter');

/**
 * Published bn + en print templates for each certificate kind the pack lists; the pack's language is the default.
 * Artwork goes to storage before the rows (same rule as PrintTemplatesService.create): a rolled-back apply leaves
 * only unreferenced objects. Reset leaves templates alone; a kind that already has a live template is skipped.
 */
export const writeCertificates: ApplyWriter = async (ctx) => {
  const { manager, tenantId, userId } = ctx;
  const templates = manager.getRepository(PrintTemplate);
  const assets = manager.getRepository(PrintAsset);
  const versions = manager.getRepository(PrintTemplateVersion);
  const defaultLang: Lang = ctx.pack.region?.locale?.startsWith('bn') ? 'bn' : 'en';
  let created = 0;

  for (const packKind of ctx.pack.certificates) {
    const cert = CERTS[packKind];
    if (!cert) continue;
    const live = await templates.exists({
      where: { tenant_id: tenantId, document_kind: cert.kind, archived_at: IsNull() },
    });
    if (live) {
      logger.debug(`kind ${cert.kind} already has a template`);
      continue;
    }

    for (const lang of ['bn', 'en'] as const) {
      const suggestion = PRINT_SUGGESTIONS.find((s) => s.key === `${cert.slug}-a4-${lang}`);
      if (!suggestion) throw new Error(`Missing print suggestion ${cert.slug}-a4-${lang}`);

      const saved: PrintAsset[] = [];
      for (const side of SIDES) {
        const file = suggestion.artwork[side];
        if (!file) continue;
        const body = await readFile(join(ARTWORK_DIR, file));
        const storage_key = tenantObjectKey(tenantId, 'print-artwork', 'svg');
        await ctx.storage.put(storage_key, body, 'image/svg+xml');
        saved.push(
          await assets.save(
            assets.create({
              tenant_id: tenantId,
              asset_kind: PrintAssetKind.ARTWORK,
              storage_key,
              content_type: 'image/svg+xml',
              byte_size: body.length,
              original_name: file,
              uploaded_by: userId,
            }),
          ),
        );
      }
      const [front, back] = saved;
      const draft: TemplateDefinition = structuredClone(suggestion.definition);
      draft.front.background = { assetId: front!.id, print: true };
      if (back && draft.back) draft.back.background = { assetId: back.id, print: true };
      // A broken ready-made design is a bug: throw and roll the whole apply back.
      const result = validateTemplateDefinition(draft, cert.kind);
      if (!result.success) {
        throw new Error(`Ready-made ${suggestion.key} is invalid: ${result.errors.join('; ')}`);
      }
      const definition = result.data;

      const template = await templates.save(
        templates.create({
          tenant_id: tenantId,
          document_kind: cert.kind,
          name: cert.names[lang],
          is_default: lang === defaultLang,
          draft,
          created_by: userId,
        }),
      );
      const version = await versions.save(
        versions.create({
          tenant_id: tenantId,
          template_id: template.id,
          version: 1,
          definition,
          published_by: userId,
        }),
      );
      template.current_version_id = version.id;
      await templates.save(template);
      created += 1;
    }
  }
  return { print_templates: created };
};
