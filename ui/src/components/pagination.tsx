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
  // `page` routinely comes straight from a URL query param, and `pageSize`
  // from wherever a caller's page-size selector defaults to before it's
  // loaded — neither is guaranteed in-range. Clamping here means a stale
  // `?page=999` after a filter shrinks the result set self-heals to the
  // last real page instead of rendering a negative/overflowing range, and
  // `pageSize=0` can't produce `Math.ceil(x / 0) === Infinity`.
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const rangeStart = totalCount === 0 ? 0 : (currentPage - 1) * safePageSize + 1;
  const rangeEnd = Math.min(currentPage * safePageSize, totalCount);

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
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          {previousLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          {nextLabel}
        </Button>
      </div>
    </nav>
  );
}
