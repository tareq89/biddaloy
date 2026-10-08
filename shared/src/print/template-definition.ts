import { z } from 'zod';

import { DocumentKind, ImageFit, OverflowPolicy, ShapeKind } from '../enums/print';
import { FIELD_CATALOG, type FieldDef } from './field-catalog';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #rrggbb');
const mm = z.number().min(0);

const base = {
  id: z.string().min(1),
  x: mm,
  y: mm,
  w: mm,
  h: mm,
};

/**
 * `{{key}}` inside a fixed text (D43). Double braces, so the copy label's `{n}` is untouched.
 * Not global, so `.test()`/`.exec()` carry no `lastIndex`; the helpers below make a `/g` copy.
 */
export const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/;
const placeholdersG = () => new RegExp(PLACEHOLDER_PATTERN, 'g');

/** Placeholder keys in order of appearance, de-duplicated. */
export function textPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(placeholdersG())].map((m) => m[1] as string))];
}

/** Replace every placeholder with `lookup(key)`; unknown keys are the lookup's call (return ''). */
export function fillPlaceholders(text: string, lookup: (key: string) => string): string {
  return text.replace(placeholdersG(), (_, key: string) => lookup(key));
}

/** Exactly one of `a` / `b` must be set. */
const xor = (a: string, b: string) => (e: Record<string, unknown>) =>
  (e[a] !== undefined) !== (e[b] !== undefined);

const textElement = z
  .object({
    ...base,
    type: z.literal('TEXT'),
    text: z.string().optional(),
    field: z.string().optional(),
    fontFamily: z.string().min(1),
    fontAssetId: z.uuid().optional(),
    sizePt: z.number().min(4).max(96),
    minSizePt: z.number().min(4).max(96).optional(),
    weight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]),
    color: hex,
    align: z.enum(['left', 'center', 'right']),
    overflow: z.enum(Object.values(OverflowPolicy) as [OverflowPolicy, ...OverflowPolicy[]]),
  })
  .refine(xor('text', 'field'), { message: 'TEXT needs exactly one of text or field' });

const imageElement = z
  .object({
    ...base,
    type: z.literal('IMAGE'),
    assetId: z.uuid().optional(),
    field: z.string().optional(),
    fit: z.enum(Object.values(ImageFit) as [ImageFit, ...ImageFit[]]),
    alignY: z.enum(['top', 'center']),
  })
  .refine(xor('assetId', 'field'), { message: 'IMAGE needs exactly one of assetId or field' });

const qrElement = z.object({ ...base, type: z.literal('QR') });

const shapeElement = z.object({
  ...base,
  type: z.literal('SHAPE'),
  shape: z.enum(Object.values(ShapeKind) as [ShapeKind, ...ShapeKind[]]),
  stroke: hex.optional(),
  fill: hex.optional(),
  strokeWidthMm: z.number().min(0).max(5),
  radiusMm: z.number().min(0).max(20),
});

const printElement = z.discriminatedUnion('type', [
  textElement,
  imageElement,
  qrElement,
  shapeElement,
]);

const side = z.object({
  background: z.object({ assetId: z.uuid(), print: z.boolean() }).optional(),
  elements: z.array(printElement).max(200),
});

export const templateDefinitionSchema = z
  .object({
    page: z.object({
      widthMm: z.number().min(10).max(600),
      heightMm: z.number().min(10).max(600),
      sides: z.union([
        z.tuple([z.literal('front')]),
        z.tuple([z.literal('front'), z.literal('back')]),
      ]),
    }),
    /** e.g. "Copy {n}" or "DUPLICATE"; the `print.copyLabel` field renders it only when copy > 1 (D23). */
    copyLabel: z.object({ text: z.string().max(40) }).optional(),
    front: side,
    back: side.optional(),
  })
  .superRefine((def, ctx) => {
    if ((def.page.sides.length === 2) !== (def.back !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['back'],
        message: 'back must exist iff sides includes back',
      });
    }
    for (const name of ['front', 'back'] as const) {
      def[name]?.elements.forEach((el, i) => {
        if (el.x + el.w > def.page.widthMm || el.y + el.h > def.page.heightMm) {
          ctx.addIssue({
            code: 'custom',
            path: [name, 'elements', i],
            message: 'element must fit inside the page',
          });
        }
      });
    }
  });

export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;
export type PrintElement = z.infer<typeof printElement>;

export type TemplateValidationResult =
  { success: true; data: TemplateDefinition } | { success: false; errors: string[] };

/** Longest fixed TEXT (D43). Checked here, not in the zod schema, so stored drafts are grandfathered. */
export const TEXT_MAX_LENGTH = 2000;

/**
 * Zod parse, plus every bound `field` must exist in `FIELD_CATALOG[kind]` with a matching type (D29).
 * The fixed-text rules added in Epic 48 (length, `{{placeholder}}` keys) only apply to a TEXT whose
 * text differs from the same-id element in `previous` (the stored draft), so a draft saved before
 * those rules still saves and publishes; only a changed text is held to them.
 */
export function validateTemplateDefinition(
  def: unknown,
  kind: DocumentKind,
  previous?: unknown,
): TemplateValidationResult {
  const parsed = templateDefinitionSchema.safeParse(def);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }
  const catalog = FIELD_CATALOG[kind] ?? [];
  const errors: string[] = [];
  const before = previousTexts(previous);
  for (const name of ['front', 'back'] as const) {
    parsed.data[name]?.elements.forEach((el, i) => {
      if (el.type === 'TEXT' && el.text !== undefined && before.get(el.id) !== el.text) {
        if (el.text.length > TEXT_MAX_LENGTH) {
          errors.push(`${name}.elements.${i}.text: longer than ${TEXT_MAX_LENGTH} characters`);
        }
        for (const key of textPlaceholders(el.text)) {
          if (catalog.find((c) => c.key === key)?.type !== 'text') {
            errors.push(`${name}.elements.${i}.text: {{${key}}} is not a text field of ${kind}`);
          }
        }
      }
      if ((el.type !== 'TEXT' && el.type !== 'IMAGE') || el.field === undefined) return;
      const def = catalog.find((c) => c.key === el.field);
      const want = el.type === 'TEXT' ? 'text' : 'image';
      if (def?.type !== want) {
        errors.push(`${name}.elements.${i}.field: "${el.field}" is not a ${want} field of ${kind}`);
      }
    });
  }
  return errors.length ? { success: false, errors } : { success: true, data: parsed.data };
}

/** id -> text of every TEXT element in a stored draft; tolerant of any shape. */
function previousTexts(previous: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const d = previous as
    Partial<Record<'front' | 'back', { elements?: unknown }>> | null | undefined;
  for (const name of ['front', 'back'] as const) {
    const els = d?.[name]?.elements;
    if (!Array.isArray(els)) continue;
    for (const el of els as Array<Record<string, unknown>>) {
      if (el?.type === 'TEXT' && typeof el.id === 'string' && typeof el.text === 'string') {
        out.set(el.id, el.text);
      }
    }
  }
  return out;
}

/** Catalog `issueTime` fields any TEXT element binds, as `field` or as a `{{placeholder}}`, in catalog order (D3, D43). */
export function boundIssueFields(def: TemplateDefinition, kind: DocumentKind): FieldDef[] {
  const bound = new Set<string>();
  for (const name of ['front', 'back'] as const) {
    for (const el of def[name]?.elements ?? []) {
      if (el.type !== 'TEXT') continue;
      if (el.field !== undefined) bound.add(el.field);
      if (el.text !== undefined) textPlaceholders(el.text).forEach((k) => bound.add(k));
    }
  }
  return (FIELD_CATALOG[kind] ?? []).filter((c) => c.issueTime && bound.has(c.key));
}

/**
 * Errors for typed issue-time values; empty = valid. Shared by server and wizard.
 * `partial` (preview): a missing value is fine; unknown and too-long values still fail.
 */
export function validateIssueValues(
  def: TemplateDefinition,
  kind: DocumentKind,
  values: Record<string, string>,
  opts?: { partial?: boolean },
): string[] {
  const fields = boundIssueFields(def, kind);
  const errors: string[] = [];
  for (const key of Object.keys(values)) {
    if (!fields.some((f) => f.key === key))
      errors.push(`${key}: not an issue field of this template`);
  }
  for (const f of fields) {
    const v = values[f.key];
    if (v === undefined || v.trim() === '') {
      if (!opts?.partial) errors.push(`${f.key}: required`);
    } else if (v.length > (f.issueTime?.maxLength ?? 0)) {
      errors.push(`${f.key}: longer than ${f.issueTime?.maxLength} characters`);
    }
  }
  return errors;
}
