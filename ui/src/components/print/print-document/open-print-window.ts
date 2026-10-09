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
