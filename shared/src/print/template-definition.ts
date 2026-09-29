import { z } from 'zod';

import { DocumentKind, ImageFit, OverflowPolicy, ShapeKind } from '../enums/print';
import { FIELD_CATALOG } from './field-catalog';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #rrggbb');
const mm = z.number().min(0);

const base = {
  id: z.string().min(1),
  x: mm,
  y: mm,
  w: mm,
  h: mm,
};

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

/** Zod parse, plus every bound `field` must exist in `FIELD_CATALOG[kind]` with a matching type (D29). */
export function validateTemplateDefinition(
  def: unknown,
  kind: DocumentKind,
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
  for (const name of ['front', 'back'] as const) {
    parsed.data[name]?.elements.forEach((el, i) => {
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
