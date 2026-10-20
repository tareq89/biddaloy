# landing

Static marketing site (Astro 7, no framework JS). Languages: `/bn/` (default) and `/en/`.

```bash
yarn workspace @biddaloy/landing dev     # http://localhost:4321/bn/
yarn workspace @biddaloy/landing build   # -> landing/dist
yarn workspace @biddaloy/landing test    # i18n parity
```

- Shell only: `Base.astro` + `Header` / `Footer` / `ConsentBar` / `Analytics`. Pages add content and never edit these.
- Shell strings: `src/i18n/{bn,en}.json` (same keys in both; the test enforces it). Page copy lives in `src/content/` (later tickets).
- Tokens: `src/styles/tokens.css`. Source of truth is `ui/src/styles/globals.css`; re-copy when it changes.
- Fonts: Hind Siliguri, self-hosted in `public/fonts` (OFL.txt alongside). `public/fonts/fonts.css` is added after first paint by `Base.astro` (`font-display: optional`); do not import it into a page.
- Umami: set `PUBLIC_UMAMI_ID` (and optionally `PUBLIC_UMAMI_SRC`) at build time.

## Regenerating screenshots

Needs a running demo (`DEMO_MODE` on, seeded) and the shared demo password from `GET /api/v1/demo/roles`.

```bash
SHOOT_BASE_URL=http://localhost:3000 \
SHOOT_PASSWORD=<password from /api/v1/demo/roles> \
yarn workspace @biddaloy/landing shoot
```

The script signs in as each role through `/login?role=<key>`, then writes `src/assets/shots/<role>/<page>.<lang>.<theme>.png`
and `shots.placeholders.json` (16-px blur). Edit `scripts/shots.manifest.ts` to add a shot; use it in a page as
`<Shot name="admin/dashboard" lang={lang} label="..." />`. Until a PNG exists the dashed placeholder shows. Demo names are synthetic, so no masking.
