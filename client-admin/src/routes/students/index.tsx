import { useStudents, studentsQueryOptions } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';

/**
 * [8.9.1]'s AC is "search params typed and validated per route; an
 * invalid param produces a sensible fallback, not a crash" — `.catch()`
 * is what does that: a malformed `?page=abc` or an out-of-range `?page=-5`
 * both resolve to `undefined` here (never `NaN`, never a negative page),
 * the same guarantee `useListUrlState` (this route's generic sibling, see
 * `@biddaloy/ui/routes`) hand-rolled before a router existed to declare
 * it against.
 *
 * Every field is `.optional()`, with the *real* default (`page ?? 1`,
 * `limit ?? 10`, `order ?? 'asc'`) applied at the read site below rather
 * than baked into the schema's output type — that's what lets
 * `<Link to="/students">` from anywhere else in the app link here
 * without having to specify every search param just to satisfy the
 * type; TanStack Router only makes a search key optional on `<Link>` if
 * the schema's own inferred type says the key can be absent.
 */
const studentsSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  sort: z.string().min(1).optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  class_id: z.string().min(1).optional().catch(undefined),
});

export const Route = createFileRoute('/students/')({
  validateSearch: studentsSearchSchema,
  // Without `loaderDeps`, the loader only reruns when path params
  // change — a route's `search` isn't part of its cache key by default.
  // Naming exactly the fields the query needs is what makes clicking
  // "Next page" (or hovering a link to `?page=2`) actually prefetch page
  // 2's data, not silently keep page 1's.
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 10,
    classId: search.class_id,
  }),
  loader: ({ context: { queryClient }, deps }) =>
    queryClient.ensureQueryData(
      studentsQueryOptions({
        page: deps.page,
        limit: deps.limit,
        ...(deps.classId !== undefined ? { class_id: deps.classId } : {}),
      }),
    ),
  component: StudentsListPage,
});

function StudentsListPage() {
  const search = Route.useSearch();
  const { t } = useTranslation('students');
  const page = search.page ?? 1;
  const limit = search.limit ?? 10;
  const studentsQuery = useStudents({
    page,
    limit,
    ...(search.class_id !== undefined ? { class_id: search.class_id } : {}),
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('list.title')}</h1>
      <p className="text-sm text-muted-foreground">
        {t('list.pageLabel', { page })}
        {search.class_id !== undefined &&
          ` — ${t('list.filterByClass', { classId: search.class_id })}`}
      </p>

      <ul className="flex flex-col gap-1">
        {studentsQuery.data?.data.map((student) => (
          <li key={student.id}>
            <Link
              to="/students/$studentId"
              params={{ studentId: student.id }}
              className="text-primary underline"
            >
              {t('list.viewButton', { name: student.full_name })}
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <Link
          to="/students"
          search={(prev) => ({ ...prev, page: (prev.page ?? 1) + 1 })}
          className="text-sm text-primary underline"
        >
          {t('list.nextPage')}
        </Link>
        {search.class_id !== undefined && (
          <Link
            to="/students"
            search={(prev) => {
              const rest = { ...prev };
              delete rest.class_id;
              return rest;
            }}
            className="text-sm text-primary underline"
          >
            {t('list.clearFilter')}
          </Link>
        )}
      </div>
    </div>
  );
}
