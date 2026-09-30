/**
 * [32.3.3] The design kit a designer downloads (D6, D52): an SVG artboard at the exact
 * paper size, plus a short README. The SVG has three layers:
 *
 *   guides   page edge + dashed 3 mm safe zone   (delete before export)
 *   artwork  empty - design here
 *   fields   one sample {{key}} text per field, to copy into the design
 *
 * The README is English on purpose: it is handed to an outside designer's tools.
 */
import { FIELD_CATALOG, type DocumentKind, type TemplateDefinition } from '@biddaloy/shared';

const SAFE_ZONE_MM = 3;

export function buildDesignKit(
  page: TemplateDefinition['page'],
  kind: DocumentKind,
): { svg: string; readme: string } {
  const { widthMm: w, heightMm: h } = page;
  const orientation = w > h ? 'landscape' : w < h ? 'portrait' : 'square';
  const textFields = FIELD_CATALOG[kind].filter((f) => f.type === 'text');
  const step = Math.min(4, (h - 2 * SAFE_ZONE_MM) / Math.max(textFields.length, 1));

  const samples = textFields
    .map(
      (f, i) =>
        `    <text x="${SAFE_ZONE_MM}" y="${(SAFE_ZONE_MM + step * (i + 1)).toFixed(2)}" font-size="${Math.max(step * 0.7, 1).toFixed(2)}">{{${f.key}}}</text>`,
    )
    .join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">
  <g id="guides" fill="none" stroke="#e11d48" stroke-width="0.2">
    <rect x="0" y="0" width="${w}" height="${h}"/>
    <rect x="${SAFE_ZONE_MM}" y="${SAFE_ZONE_MM}" width="${w - 2 * SAFE_ZONE_MM}" height="${h - 2 * SAFE_ZONE_MM}" stroke-dasharray="1 1"/>
  </g>
  <g id="artwork"></g>
  <g id="fields" fill="#000000">
${samples}
  </g>
</svg>
`;

  const readme = `Biddaloy design kit
====================

Artboard: ${w} x ${h} mm (${orientation}). 1 unit in the SVG = 1 mm.

1. Design in the "artwork" layer. Keep everything important inside the dashed
   safe zone (${SAFE_ZONE_MM} mm from every edge); printers can clip the edge.
2. Copy the {{field}} texts from the "fields" layer where you want that
   information to appear. Set their font, size, colour and alignment as you like.
   Keep every {{field}} as LIVE text, one per text box.
3. Outline (convert to shapes) all OTHER text, so it looks the same everywhere.
4. Delete the "guides" layer, then export.

Export settings
---------------
Illustrator: SVG 1.1, Styling: Internal CSS, Font: SVG (then convert static text
  to outlines first), Images: Embed, Decimal places: 3, Responsive: OFF.
Inkscape:    Save as "Plain SVG".
Figma / Affinity: Export as SVG; outline all text except the {{field}} boxes.

Then in Biddaloy: open the template, Files > "Import from Illustrator / SVG".
`;
  return { svg, readme };
}

/** Saves text as a file through a temporary link. */
export function downloadTextFile(name: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
