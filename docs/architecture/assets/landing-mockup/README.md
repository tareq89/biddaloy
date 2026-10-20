# Landing mockup v5 (locked 2026-10-20)

The **locked visual base** for Epic 50 (#1650). Implementers port this HTML to
Astro components; the look, copy, section order and spacing must match these
screenshots. Copy changes go through the owner.

| File | What |
|---|---|
| `landing-mockup-v5.html` | the whole prototype: one file, all six pages (`#home`, `#features`, `#pricing`, `#testimonials`, `#contact`, `#privacy`), CSS tokens at the top, Hind Siliguri from Google Fonts |
| `*-desktop.png` | full-page screenshot at 1440 px |
| `*-phone.png` | full-page screenshot at 390 px |

How to view it: open the HTML in a browser (`python3 -m http.server` in this
folder, then `http://localhost:8000/landing-mockup-v5.html`). The grey bar at
the top is a page switcher for the mockup only; it is not part of the site.

How to regenerate the screenshots after a mockup change:

```bash
# serve this folder on :4321, then from the repo root
OUT=docs/architecture/assets/landing-mockup node --input-type=module -e "$(cat scripts/shoot-landing-mockup.mjs)"
```

Decisions behind every element: #1650 → "Design direction" and D1–D45.
Dashed boxes are placeholders for screenshots/videos taken from the demo
school (#2727). Office address, phone numbers and school logos are placeholders.
