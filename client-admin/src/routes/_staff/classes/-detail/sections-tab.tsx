import { SectionsPanel } from '../-sections-panel';

export interface SectionsTabProps {
  classId: string;
}

/** Thin wrapper — `SectionsPanel` owns its own query and dialogs. */
export function SectionsTab({ classId }: SectionsTabProps) {
  return <SectionsPanel classId={classId} />;
}
