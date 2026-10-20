# landing

Static marketing site (Astro 5, no framework JS). Languages: `/bn/` (default) and `/en/`.

```bash
yarn workspace @biddaloy/landing dev     # http://localhost:4321/bn/
yarn workspace @biddaloy/landing build   # -> landing/dist
yarn workspace @biddaloy/landing test    # i18n parity
```

- Shell only: `Base.astro` + `Header` / `Footer` / `ConsentBar` / `Analytics`. Pages add content and never edit these.
- Shell strings: `src/i18n/{bn,en}.json` (same keys in both; the test enforces it). Page copy lives in `src/content/` (later tickets).
- Tokens: `src/styles/tokens.css`. Source of truth is `ui/src/styles/globals.css`; re-copy when it changes.
- Fonts: Hind Siliguri, self-hosted in `public/fonts` (OFL.txt alongside).
- Umami: set `PUBLIC_UMAMI_ID` (and optionally `PUBLIC_UMAMI_SRC`) at build time.
