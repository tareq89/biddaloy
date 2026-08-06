/**
 * Announces the current range and total via a polite live region — "21–40
 * of 145", not just a bare page number, so a screen-reader user gets the
 * same "where am I" signal a sighted user reads off the page instantly.
 */
import { Button } from './button';

export interface PaginationProps {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  previousLabel?: string;
  nextLabel?: string;
}

export function Pagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  previousLabel = 'Previous',
  nextLabel = 'Next',
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalCount);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
      <span aria-live="polite" className="text-muted-foreground">
        {totalCount === 0 ? 'No results' : `Showing ${rangeStart}–${rangeEnd} of ${totalCount}`}
      </span>
      <div className="flex gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {previousLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          {nextLabel}
        </Button>
      </div>
    </nav>
  );
}
