/**
 * [66.1.06] "Exam syllabus up to here" — a full-width row between lessons.
 * `ExamMarkerLine` is the line alone, for the phone card list;
 * `ExamMarkerRow` wraps it in a table row. Labels are props.
 */
import { FlagIcon, PencilIcon } from 'lucide-react';

import { Button } from './button';
import { TableCell, TableRow } from './table';

/** `editLabel` (a verb, e.g. "Edit marker") is required whenever `onEdit` is set. */
export type ExamMarkerLineProps = {
  title: string;
  meta?: string;
} & ({ onEdit: () => void; editLabel: string } | { onEdit?: undefined; editLabel?: string });

export function ExamMarkerLine({ title, meta, onEdit, editLabel }: ExamMarkerLineProps) {
  return (
    <div className="flex items-center gap-3 text-primary">
      <FlagIcon className="size-4 shrink-0" aria-hidden />
      <span className="text-label">{title}</span>
      <span aria-hidden="true" className="flex-1 border-t-2 border-dashed border-primary" />
      {meta && <span className="text-caption text-text-secondary">{meta}</span>}
      {onEdit && (
        <Button
          type="button"
          variant="ghost"
          iconOnly
          aria-label={editLabel}
          className="size-11 text-text-secondary md:size-8"
          onClick={onEdit}
        >
          <PencilIcon aria-hidden />
        </Button>
      )}
    </div>
  );
}

export type ExamMarkerRowProps = ExamMarkerLineProps & { colSpan: number };

export function ExamMarkerRow({ colSpan, ...line }: ExamMarkerRowProps) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan}>
        <ExamMarkerLine {...line} />
      </TableCell>
    </TableRow>
  );
}
