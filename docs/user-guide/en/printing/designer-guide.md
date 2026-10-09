# Designer guide: making artwork in Illustrator, Inkscape, Affinity or Figma

This page is for the person who draws the card. If you follow it, you can give
the school one SVG file and they can import it in a single step.

## How it works

You draw the **background** (colours, logo, border, the fixed words). Wherever a
name, class or photo belongs, you write a **placeholder** such as
`{{student.name}}`. SchoolManager moves each placeholder into an editable field
and removes the text from the picture, so nothing prints twice.

## 1. Start from the design kit

Ask the school to open **Templates → your template → Files → Download design
kit**. You get two files:

- `design-kit.svg` — an empty artboard at exactly the card size, with three
  layers: **guides**, **artwork** and **fields**.
- `design-kit-README.txt` — these instructions in short.

Design inside the **artwork** layer. The **fields** layer has one sample
`{{field}}` text for every field you can use; copy the ones you need.

## 2. Sizes and orientation

Sizes are in millimetres. Choose the artboard that matches the card.

| Card           | Width × Height | Orientation |
| -------------- | -------------- | ----------- |
| CR80 portrait  | 54 × 85.6 mm   | Tall        |
| CR80 landscape | 85.6 × 54 mm   | Wide        |

If your artboard has a different shape, the import shows a warning like
"Your artboard is 60 × 90 mm. This template is 54 × 85.6 mm".

## 3. Safe zone and bleed

- **Safe zone: 3 mm.** Keep names, photos and logos at least 3 mm inside every
  edge. Printers can cut a little off.
- **Bleed.** If your colour goes to the edge, let it run past the edge in your
  artwork. Home and office printers cannot print to the very edge, so the school
  may see a thin white border. Card printers can.

## 4. Text: outline the fixed words, keep the fields live

- **Outline** (convert to shapes) all fixed text, such as the school name.
  Then it looks the same on every computer.
- Keep every `{{field}}` as **normal, live text**, one field in **its own text
  box**. Do not put other words in the same box: `Name: {{student.name}}` cannot
  be imported.
- Set the font, size, colour and alignment you want on the placeholder. The
  import copies them.

## 5. Fields you can use

**Student card**

`{{school.name}}` · `{{school.name_bn}}` · `{{school.address}}` ·
`{{school.phone}}` · `{{student.name}}` · `{{student.name_bn}}` ·
`{{student.class}}` · `{{student.section}}` · `{{student.roll}}` ·
`{{student.registration_number}}` · `{{student.blood_group}}` ·
`{{student.date_of_birth}}` · `{{guardian.phone}}` · `{{card.valid_until}}` ·
`{{print.issue_date}}` · `{{print.copyLabel}}`

**Staff card**

`{{school.name}}` · `{{school.name_bn}}` · `{{school.address}}` ·
`{{school.phone}}` · `{{staff.name}}` · `{{staff.name_bn}}` ·
`{{staff.designation}}` · `{{staff.employee_id}}` · `{{staff.blood_group}}` ·
`{{staff.phone}}` · `{{card.valid_until}}` · `{{print.issue_date}}` ·
`{{print.copyLabel}}`

Photos, the school logo and the QR code are **not** typed as text. The school
places them in the editor after the import.

## 6. Export settings

Delete the **guides** layer first. Then export as SVG.

**Illustrator** — File → Save As → SVG, then:

- SVG Profiles: **SVG 1.1**
- Styling: **Internal CSS**
- Fonts, Type: **SVG**. First convert fixed text to outlines; leave `{{field}}`
  boxes as live text.
- Images: **Embed**
- Decimal places: **3**
- **Responsive: off**

**Inkscape** — Save as **Plain SVG**.

**Affinity Designer** — Export → SVG. Turn on "Export text as curves" for the
fixed text only; keep the `{{field}}` text as text.

**Figma** — Export as SVG. Outline the fixed text (right-click → Outline
stroke / Flatten) and keep the `{{field}}` text layers as text.

## 7. What the import warnings mean

| Warning                                           | What it means and what to do                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| "_{{something}} is not a field of this document_" | The name is wrong for this card type. It stays in the picture. Fix the spelling using the list above.  |
| "_Font not available, using Biddaloy Sans_"       | The school has not uploaded that font. Ask them to upload it (Files → Fonts), or use a font they have. |
| "_Your artboard is … mm_"                         | The artboard shape is not the card shape. Re-export at the exact size.                                 |
| "_mixes a field with other words_"                | Put each field in its own text box.                                                                    |
| "No fields were found"                            | The file will only be used as a background. Check the placeholders are live text, not outlines.        |

## Checklist before you send the file

- [ ] Artboard is the exact card size.
- [ ] Important things are 3 mm inside the edge.
- [ ] Fixed text is outlined.
- [ ] Every `{{field}}` is live text in its own box.
- [ ] Guides layer deleted.
- [ ] Exported as SVG with images embedded.
