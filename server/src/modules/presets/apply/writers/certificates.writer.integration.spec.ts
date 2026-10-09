import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, IsNull } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { DocumentKind } from '@biddaloy/shared';
import type { PresetCertificateKind } from '@biddaloy/shared';
import { makeTestPack } from '../../__fixtures__/test-pack';
import { NCTB_PACK as nctb } from '../../packs/bd/nctb';
import type { ApplyContext } from '../apply-context';
import { School } from '../../../schools/entities/school.entity';
import { User } from '../../../users/entities/user.entity';
import { PrintTemplate } from '../../../print/entities/print-template.entity';
import { PrintTemplateVersion } from '../../../print/entities/print-template-version.entity';
import { ALIA_PACK } from '../../packs/bd/alia-madrasa';
import { uploadCertificateArtwork, writeCertificates } from './certificates.writer';

describe('writeCertificates (integration)', () => {
  let ds: DataSource;
  let userId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
    userId = randomUUID();
    await ds.getRepository(User).save({
      id: userId,
      email: `certs-${userId}@example.com`,
      password_hash: 'x',
      full_name: 'Certs Admin',
    });
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const newSchool = async (): Promise<string> => {
    const id = randomUUID();
    await ds.getRepository(School).save({ id, name: 'Certs School', slug: `certs-${id}` });
    return id;
  };

  async function run(
    pack: ReturnType<typeof makeTestPack>,
    before?: (tenantId: string) => Promise<void>,
  ) {
    const tenantId = await newSchool();
    await before?.(tenantId);
    const puts: string[] = [];
    const storage = {
      put: async (key: string) => {
        puts.push(key);
      },
    } as never;
    const artwork = await uploadCertificateArtwork(pack, tenantId, storage);
    const counts = await ds.transaction((manager) => {
      const ctx: ApplyContext = {
        manager,
        tenantId,
        userId,
        pack,
        options: { presetId: pack.id, startYear: 2026, stages: [], versions: [] },
        artwork,
        ids: {
          classIdByKey: new Map(),
          subjectIdByCode: new Map(),
          classSubjectIdByKey: new Map(),
        },
      };
      return writeCertificates(ctx);
    });
    return { tenantId, counts, puts };
  }

  const packWith = (certificates: PresetCertificateKind[], locale?: string) => {
    const pack = makeTestPack();
    pack.certificates = certificates;
    if (locale) pack.region = { locale };
    return pack;
  };

  const live = (tenant_id: string) =>
    ds.getRepository(PrintTemplate).find({ where: { tenant_id, archived_at: IsNull() } });

  it('NCTB (bn-BD): 6 published templates, the 3 bn ones default, 6 artwork uploads', async () => {
    const { tenantId, counts, puts } = await run(nctb);
    expect(counts).toEqual({ print_templates: 6 });
    expect(puts).toHaveLength(6);

    const rows = await live(tenantId);
    expect(rows).toHaveLength(6);
    const defaults = rows.filter((r) => r.is_default);
    expect(defaults.map((r) => r.name).sort()).toEqual(
      ['চারিত্রিক সনদপত্র (বাংলা)', 'প্রশংসাপত্র (বাংলা)', 'ছাড়পত্র (বাংলা)'].sort(),
    );

    for (const row of rows) {
      expect(row.tenant_id).toBe(tenantId);
      const version = await ds
        .getRepository(PrintTemplateVersion)
        .findOneByOrFail({ id: row.current_version_id! });
      expect(version.version).toBe(1);
      // Epic 48 D43: every certificate shows its serial number.
      expect(JSON.stringify(version.definition)).toContain('print.serial_no');
    }
  });

  it('en locale: the English template is the default', async () => {
    const { tenantId, counts } = await run(packWith(['TESTIMONIAL'], 'en-US'));
    expect(counts).toEqual({ print_templates: 2 });
    const rows = await live(tenantId);
    expect(rows.filter((r) => r.is_default).map((r) => r.name)).toEqual(['Testimonial (English)']);
  });

  it('Alia (pack has no locale): the Bangla template is the default (#1984)', async () => {
    const { tenantId } = await run(ALIA_PACK);
    const rows = await live(tenantId);
    expect(
      rows
        .filter((r) => r.is_default)
        .map((r) => r.name)
        .sort(),
    ).toEqual(['চারিত্রিক সনদপত্র (বাংলা)', 'প্রশংসাপত্র (বাংলা)', 'ছাড়পত্র (বাংলা)'].sort());
  });

  it('TRANSCRIPT only: nothing created, no storage call', async () => {
    const { tenantId, counts, puts } = await run(packWith(['TRANSCRIPT']));
    expect(counts).toEqual({ print_templates: 0 });
    expect(puts).toHaveLength(0);
    expect(await live(tenantId)).toHaveLength(0);
  });

  it('a kind that already has a live template is skipped; the existing one stays default', async () => {
    const { tenantId, counts } = await run(packWith(['TESTIMONIAL', 'CHARACTER']), async (t) => {
      await ds.getRepository(PrintTemplate).save({
        tenant_id: t,
        document_kind: DocumentKind.TESTIMONIAL,
        name: 'Our own testimonial',
        is_default: true,
        draft: {} as never,
        created_by: userId,
      });
    });
    // Only the character kind (2 templates) is new.
    expect(counts).toEqual({ print_templates: 2 });
    const rows = await live(tenantId);
    const testimonials = rows.filter((r) => r.document_kind === DocumentKind.TESTIMONIAL);
    expect(testimonials.map((r) => [r.name, r.is_default])).toEqual([
      ['Our own testimonial', true],
    ]);
  });

  it('tenant isolation: another school gets nothing', async () => {
    const { tenantId } = await run(packWith(['TRANSFER']));
    const other = await newSchool();
    expect(await live(tenantId)).toHaveLength(2);
    expect(await live(other)).toHaveLength(0);
  });
});
