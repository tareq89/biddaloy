/**
 * [#3216] The live CSP is `style-src 'self'`, and a `blob:` document inherits it, so the
 * `<style>` tag and every `style="..."` attribute in the print HTML are ignored by the browser.
 * Setting styles through the CSSOM is not blocked, so once the document has loaded we copy
 * them over: the `<style>` text into an adopted stylesheet, each style attribute into
 * `el.style.cssText`. Where the browser has no constructable stylesheets nothing changes.
 */
export function applyStylesThroughCssom(win: Window): void {
  const doc = win.document;
  try {
    const sheet = new (win as unknown as { CSSStyleSheet: typeof CSSStyleSheet }).CSSStyleSheet();
    sheet.replaceSync(
      Array.from(doc.querySelectorAll('style'))
        .map((el) => el.textContent ?? '')
        .join('\n'),
    );
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  } catch {
    // No constructable stylesheets: leave the document as built.
  }
  doc.querySelectorAll<HTMLElement | SVGElement>('[style]').forEach((el) => {
    el.style.cssText = el.getAttribute('style') ?? '';
  });
}

/**
 * Opens the print tab synchronously (inside the click handler, so popup
 * blockers allow it), then fills it once `prepare` resolves. `prepare` POSTs
 * the print job first and builds the HTML second, so a failed POST shows
 * nothing (D9/D53). Same shape as `openPrintableInvoice` in hooks/invoices.ts.
 */
export async function openPrintWindow(
  prepare: () => Promise<string>,
  onError: (e: Error) => void,
): Promise<void> {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    onError(new Error('POPUP_BLOCKED'));
    return;
  }
  printWindow.opener = null;

  try {
    const html = await prepare();
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    printWindow.onload = () => {
      try {
        applyStylesThroughCssom(printWindow);
      } catch {
        // Best-effort, like print() below.
      }
      try {
        printWindow.print();
      } catch {
        // Best-effort: the user can still print by hand (Ctrl/Cmd+P).
      }
    };
    printWindow.location.href = url;
    // Revoking before the print dialog reads the blob prints a blank page.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    printWindow.close();
    onError(e instanceof Error ? e : new Error(String(e)));
  }
}
