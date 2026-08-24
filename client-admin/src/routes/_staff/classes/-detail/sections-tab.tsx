import { SectionsPanel } from '../-sections-panel';

export interface SectionsTabProps {
  classId: string;
  className: string;
}

/** Thin wrapper — `SectionsPanel` (own its own query/dialogs) is shared
 * verbatim with `index.tsx`'s inline expansion panel, see that file's
 * header comment. */
export function SectionsTab({ classId, className }: SectionsTabProps) {
  return <SectionsPanel classId={classId} className={className} padded={false} />;
}
