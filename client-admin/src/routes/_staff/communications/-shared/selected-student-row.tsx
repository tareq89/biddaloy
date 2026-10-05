import { Button } from '@biddaloy/ui/components';
import { RepeatIcon } from 'lucide-react';

/** The picked student as a muted strip with a "change" action — shared by Send Message and Fee Reminders. */
export function SelectedStudentRow({
  name,
  registrationNumber,
  changeLabel,
  onChange,
}: {
  name: string;
  registrationNumber: string;
  changeLabel: string;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-muted py-1 ps-3 pe-1">
      <div className="min-w-0">
        <p className="truncate font-medium">{name}</p>
        <p className="text-caption text-text-secondary">{registrationNumber}</p>
      </div>
      <Button type="button" variant="ghost" className="shrink-0 text-primary" onClick={onChange}>
        <RepeatIcon aria-hidden />
        {changeLabel}
      </Button>
    </div>
  );
}
