import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { resolveTenantSettings } from '../../schools/settings/tenant-settings-resolver';
import { ALL_TABS, assertRegistryValid, EXPECTED_TABS } from '../codec/registry';
import { writeWorkbook, SAMPLE_ROW_ID, type SheetDecorator } from '../codec/workbook-codec';
import { SCHEMA_VERSION, type WorkbookMeta } from '../codec/meta';
import type { ColumnSpec, TabSpec } from '../codec/tab-spec';
import type { TemplateLang } from './template.constants';

const LABELS = {
  requiredNote: { en: 'required', bn: 'আবশ্যক' },
  optionalNote: { en: 'optional', bn: 'ঐচ্ছিক' },
  boolValues: { en: ['TRUE', 'FALSE'], bn: ['TRUE', 'FALSE'] },
  readmeTitle: { en: 'How to fill this template', bn: 'এই টেমপ্লেট কীভাবে পূরণ করবেন' },
  fillOrder: {
    en: 'Fill the sheets in the order they appear in this workbook — a later sheet may refer to an earlier one.',
    bn: 'এই ওয়ার্কবুকে যে ক্রমে শিটগুলো আছে, সেই ক্রমেই পূরণ করুন — পরের কোনো শিট আগেরটির তথ্য উল্লেখ করতে পারে।',
  },
  sampleNote: {
    en: 'Every sheet has one example row (its "id" column says SAMPLE). It is ignored on import — delete it or leave it, either is fine.',
    bn: 'প্রতিটি শিটে একটি উদাহরণ সারি আছে ("id" কলামে SAMPLE লেখা)। ইমপোর্টের সময় এটি উপেক্ষা করা হয় — চাইলে মুছে ফেলুন বা রেখে দিন, দুটোই ঠিক আছে।',
  },
  idNote: {
    en: 'The "id" column is required on every row. Use a fresh random ID (e.g. a UUID) for a new row, or the same ID as an earlier export to update that row.',
    bn: 'প্রতিটি সারিতে "id" কলাম আবশ্যক। নতুন সারির জন্য একটি নতুন র‍্যান্ডম আইডি (যেমন UUID) ব্যবহার করুন, অথবা আগের কোনো সারি হালনাগাদ করতে চাইলে আগে এক্সপোর্ট করা সেই আইডিটিই ব্যবহার করুন।',
  },
  sheetLabel: { en: 'Sheet', bn: 'শিট' },
  naturalKeyLabel: { en: '  Identified by', bn: '  যেভাবে শনাক্ত হয়' },
  requiredColumnsLabel: { en: '  Required columns', bn: '  আবশ্যক কলাম' },
  none: { en: '(none)', bn: '(নেই)' },
} as const;

/**
 * A value for `col` that looks right to a human and round-trips through
 * `toCell`. Never re-validated on import: `readWorkbook` skips a row whose
 * `id` cell is `SAMPLE` before `fromRow`/`fromCell` ever see it, so these
 * values only have to be *legible*, not strictly valid.
 */
function sampleValue(col: ColumnSpec): unknown {
  switch (col.type) {
    case 'uuid':
      return SAMPLE_ROW_ID;
    case 'int':
      return 1;
    case 'money':
      return '100.00';
    case 'date':
      return '2026-01-01';
    case 'datetime':
      return '2026-01-01T00:00:00.000Z';
    case 'bool':
      return true;
    case 'enum':
      return col.enumValues?.[0] ?? '';
    case 'json':
      return {};
    case 'ref':
      return `(sample ${col.ref} row)`;
    case 'ref-list':
      return [`(sample ${col.ref} row)`];
    case 'string':
    default:
      return `Sample ${col.label.en}`;
  }
}

function buildSampleRow(tab: TabSpec<any, any>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const col of tab.columns) {
    row[col.key] = col.key === 'id' ? SAMPLE_ROW_ID : sampleValue(col);
  }
  return row;
}

/**
 * Adds a dropdown for every enum/bool column and a "what is this column"
 * comment for every header cell, via `writeWorkbook`'s `decorate` hook.
 */
function decorateSheet(sheet: SheetDecorator, tab: TabSpec<any, any>, lang: TemplateLang): void {
  tab.columns.forEach((col, index) => {
    const colNo = index + 1;
    const requirementNote = col.required ? LABELS.requiredNote[lang] : LABELS.optionalNote[lang];
    sheet.setHeaderNote(colNo, `${col.label[lang]} — ${requirementNote}`);

    if (col.type === 'enum' && col.enumValues && col.enumValues.length > 0) {
      sheet.addListValidation(colNo, col.enumValues, !col.required);
    } else if (col.type === 'bool') {
      sheet.addListValidation(colNo, LABELS.boolValues[lang], !col.required);
    }
  });
}

/** Plain-language fill instructions, in registry order, from the same
 * `ColumnSpec.label`s the sheets themselves use — see the repo's
 * "dead simple to understand" documentation rule. */
function buildReadmeRows(lang: TemplateLang): (string | number)[][] {
  const rows: (string | number)[][] = [
    [LABELS.readmeTitle[lang]],
    [LABELS.fillOrder[lang]],
    [LABELS.sampleNote[lang]],
    [LABELS.idNote[lang]],
    [''],
  ];

  for (const tab of ALL_TABS) {
    const naturalKeyLabels = tab.naturalKey
      .map((key) => tab.columns.find((c) => c.key === key)?.label[lang] ?? key)
      .join(', ');
    const requiredLabels = tab.columns
      .filter((c) => c.required)
      .map((c) => c.label[lang])
      .join(', ');

    rows.push([`${LABELS.sheetLabel[lang]}: ${tab.name}`]);
    rows.push([`${LABELS.naturalKeyLabel[lang]}: ${naturalKeyLabels || LABELS.none[lang]}`]);
    rows.push([`${LABELS.requiredColumnsLabel[lang]}: ${requiredLabels || LABELS.none[lang]}`]);
  }

  return rows;
}

@Injectable()
export class TemplateService {
  constructor(@InjectRepository(School) private readonly schools: Repository<School>) {}

  /** The tenant's own configured locale, mapped to `bn`/`en` — the default
   * used when the caller passes no `?lang=`. Falls back to `bn`, matching
   * `DEFAULT_REGION_SETTINGS.locale` (`'bn-BD'`). */
  async defaultLang(tenantId: string): Promise<TemplateLang> {
    const school = await this.findSchoolOrThrow(tenantId);
    const { region } = resolveTenantSettings(school.settings);
    // `resolveTenantSettings` always fills `region` from
    // `DEFAULT_REGION_SETTINGS` (never omits it) — the `?` on
    // `TenantSettings.region` exists for callers that build the type by
    // hand, not for this function's actual return value.
    return (region?.locale ?? 'bn-BD').toLowerCase().startsWith('en') ? 'en' : 'bn';
  }

  /**
   * Builds a blank workbook: every `ALL_TABS` sheet with a header row, one
   * `SAMPLE` row showing the expected shape, enum/bool dropdowns, and a
   * `_readme` sheet with fill instructions — all in `lang`.
   */
  async build(tenantId: string, lang: TemplateLang): Promise<Buffer> {
    const school = await this.findSchoolOrThrow(tenantId);

    assertRegistryValid(ALL_TABS, { partial: ALL_TABS.length < EXPECTED_TABS.length });

    const meta: WorkbookMeta = {
      schema_version: SCHEMA_VERSION,
      kind: 'TEMPLATE',
      exported_at: new Date().toISOString(),
      app_version: process.env.APP_VERSION ?? 'unknown',
      source_school_name: school.name,
      source_school_slug: school.slug,
    };

    return writeWorkbook({
      tabs: ALL_TABS,
      meta,
      readme: buildReadmeRows(lang),
      rowsFor: async function* (tab) {
        yield buildSampleRow(tab);
      },
      decorate: (sheet, tab) => decorateSheet(sheet, tab, lang),
    });
  }

  private async findSchoolOrThrow(tenantId: string): Promise<School> {
    const school = await this.schools.findOne({ where: { id: tenantId } });
    if (!school) {
      throw new NotFoundException('School not found');
    }
    return school;
  }
}
