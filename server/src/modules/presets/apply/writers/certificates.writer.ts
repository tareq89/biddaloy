import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Logger } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { DocumentKind, PrintAssetKind, validateTemplateDefinition } from '@biddaloy/shared';
import type { PresetCertificateKind, PresetPack, TemplateDefinition } from '@biddaloy/shared';
import { tenantObjectKey } from '../../../storage/storage-key';
import type { StorageService } from '../../../storage/storage.service';
import { School } from '../../../schools/entities/school.entity';
import { DEFAULT_REGION_SETTINGS } from '../../../schools/settings/tenant-settings-defaults';
import { PrintAsset } from '../../../print/entities/print-asset.entity';
import { PrintTemplate } from '../../../print/entities/print-template.entity';
import { PrintTemplateVersion } from '../../../print/entities/print-template-version.entity';
import {
  ARTWORK_DIR,
  PRINT_SUGGESTIONS,
  type ArtworkSide,
} from '../../../print/suggestions/suggestions';
import type { ApplyWriter, CertificateArtwork } from '../apply-context';

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
const LANGS = ['bn', 'en'] as const;
const logger = new Logger('PresetCertificatesWriter');

const artworkKey = (suggestionKey: string, side: ArtworkSide) => `${suggestionKey}/${side}`;

function suggestionFor(slug: string, lang: Lang) {
  const suggestion = PRINT_SUGGESTIONS.find((s) => s.key === `${slug}-a4-${lang}`);
  if (!suggestion) throw new Error(`Missing print suggestion ${slug}-a4-${lang}`);
  return suggestion;
}

/**
 * Uploads every artwork file the pack's certificates need. PresetApplyService calls it BEFORE its transaction
 * (same rule as PrintTemplatesService.create), so no storage round-trip runs under the school row lock and a
 * rolled-back apply leaves only unreferenced objects.
 * ponytail: also uploads for kinds the writer then skips (already have a live template, e.g. re-apply after
 * reset) -> a few orphaned SVGs; pre-check live kinds here if that ever matters.
 */
export async function uploadCertificateArtwork(
  pack: PresetPack,
  tenantId: string,
  storage: Pick<StorageService, 'put'>,
): Promise<Map<string, CertificateArtwork>> {
  const out = new Map<string, CertificateArtwork>();
  for (const packKind of pack.certificates) {
    const cert = CERTS[packKind];
    if (!cert) continue;
    for (const lang of LANGS) {
      const suggestion = suggestionFor(cert.slug, lang);
      for (const side of SIDES) {
        const file = suggestion.artwork[side];
        if (!file) continue;
        const body = await readFile(join(ARTWORK_DIR, file));
        const storage_key = tenantObjectKey(tenantId, 'print-artwork', 'svg');
        await storage.put(storage_key, body, 'image/svg+xml');
        out.set(artworkKey(suggestion.key, side), {
          storage_key,
          byte_size: body.length,
          original_name: file,
        });
      }
    }
  }
  return out;
}

/**
 * Published bn + en print templates for each certificate kind the pack lists; the school's language is the
 * default. Artwork is already in storage (`ctx.artwork`, see uploadCertificateArtwork). Reset leaves templates
 * alone; a kind that already has a live template is skipped.
 */
export const writeCertificates: ApplyWriter = async (ctx) => {
  const { manager, tenantId, userId } = ctx;
  const templates = manager.getRepository(PrintTemplate);
  const assets = manager.getRepository(PrintAsset);
  const versions = manager.getRepository(PrintTemplateVersion);
  // Same merge as the settings writer: a pack without a locale (Alia, Qawmi) keeps the school's / default bn-BD.
  const school = await manager.getRepository(School).findOne({ where: { id: tenantId } });
  const { locale } = {
    ...DEFAULT_REGION_SETTINGS,
    ...(school?.settings?.region ?? {}),
    ...(ctx.pack.region ?? {}),
  };
  const defaultLang: Lang = locale.startsWith('bn') ? 'bn' : 'en';
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

    for (const lang of LANGS) {
      const suggestion = suggestionFor(cert.slug, lang);

      const saved: PrintAsset[] = [];
      for (const side of SIDES) {
        if (!suggestion.artwork[side]) continue;
        const art = ctx.artwork.get(artworkKey(suggestion.key, side));
        if (!art) throw new Error(`Artwork ${suggestion.key}/${side} was not uploaded`);
        saved.push(
          await assets.save(
            assets.create({
              tenant_id: tenantId,
              asset_kind: PrintAssetKind.ARTWORK,
              content_type: 'image/svg+xml',
              uploaded_by: userId,
              ...art,
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
