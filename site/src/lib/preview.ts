/**
 * Path prefix of a theme preview. nginx serves the demo at `/website/preview/<theme>/...` but
 * strips the prefix before the site sees the request, so every internal link must put it back
 * or a click leaves the preview. A school site has no prefix (`undefined`).
 * `theme` is already checked against the real theme list by the middleware.
 */
export const previewBase = (theme: string | undefined): string | undefined =>
  theme ? `/website/preview/${theme}` : undefined;
