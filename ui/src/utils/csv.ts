/**
 * Browser-side CSV download. The escaping itself (`csvCell`,
 * `toCsvContent`) lives in `@biddaloy/shared` so the server's report
 * endpoints share one implementation — the formula guard and the UTF-8 BOM
 * are exactly the parts a second copy tends to omit.
 */
import { toCsvContent } from '@biddaloy/shared';

export { csvCell, toCsvContent } from '@biddaloy/shared';

/** Builds the CSV client-side and hands it to the browser as a download —
 * no server endpoint involved.
 *
 * The anchor is attached to the document before clicking (Firefox ignores a
 * click on a detached anchor) and the object URL is revoked on a later tick
 * (Safari aborts an in-flight download if it is revoked in the same one). */
export function downloadCsv(filename: string, rows: readonly (readonly unknown[])[]): void {
  const blob = new Blob([toCsvContent(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
