/**
 * [8.9.9]'s "find anything from anywhere". Owns the three things
 * `@biddaloy/ui`'s route-agnostic `GlobalSearch`/`useGlobalSearch`
 * deliberately don't (see `global-search.tsx`'s own header comment):
 * the Ctrl/Cmd+K listener, the debounce, and — the actual navigation —
 * deciding what a `(groupId, resultId)` selection opens in *this* app's
 * route tree.
 *
 * Result targets today:
 * - student -> its own `/students/$studentId` page.
 * - guardian -> the first student it's linked to (`Guardian.students[0]`)
 *   — guardians have no page of their own yet, so this is the closest
 *   existing destination a selection can land on, not a placeholder.
 * - invoice -> `/invoices/$invoiceId` ([8.9.9] adds this minimal stub
 *   page; the endpoint it reads already existed).
 * - receipt (payment) -> the paying student's own `/students/$studentId`
 *   page — same "closest existing destination" reasoning as guardian
 *   above; a receipt has no page of its own yet either.
 * - teacher -> nowhere. No `/teachers/:id` page or `GET /teachers/:id`
 *   endpoint exists anywhere in the app yet (see `global-search.ts`'s own
 *   comment on why the group is still shown despite that) — selecting one
 *   just closes the palette rather than linking to a page that can't
 *   exist until that ticket lands.
 */
import { Button, GlobalSearch, type GlobalSearchGroup } from '@biddaloy/ui/components';
import { useDebouncedValue, useGlobalSearch } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useNavigate } from '@tanstack/react-router';
import * as React from 'react';

const SEARCH_DEBOUNCE_MS = 300;

export function GlobalSearchLauncher() {
  const { t } = useTranslation('nav');
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const results = useGlobalSearch(debouncedQuery);

  // Global Ctrl/Cmd+K — [8.9.9]'s "opens from anywhere" AC. Not scoped to
  // any particular element, so it fires regardless of what currently has
  // focus; `preventDefault` stops the browser's own bookmark/location-bar
  // binding on that key combo from also firing.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((isOpen) => !isOpen);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Closing (Esc, a selection, or the shortcut re-firing) always starts
  // the next open on a blank query — a stale leftover search from last
  // time would otherwise flash before the user gets a chance to type.
  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const groups: GlobalSearchGroup[] = [
    {
      id: 'students',
      label: t('globalSearch.groups.students'),
      isLoading: results.students.isLoading,
      results: results.students.data.map((student) => ({
        id: student.id,
        label: student.full_name,
        description: student.class_section?.class?.name,
      })),
    },
    {
      id: 'guardians',
      label: t('globalSearch.groups.guardians'),
      isLoading: results.guardians.isLoading,
      // A guardian result only lands somewhere if it links a student —
      // guardians have no page of their own yet. Showing one that
      // navigates nowhere reads as a broken selection.
      results: results.guardians.data
        .filter((guardian) => guardian.students.length > 0)
        .map((guardian) => ({
          id: guardian.id,
          label: guardian.full_name,
          description: guardian.relationship,
        })),
    },
    {
      id: 'teachers',
      label: t('globalSearch.groups.teachers'),
      isLoading: results.teachers.isLoading,
      results: results.teachers.data.map((teacher) => ({
        id: teacher.id,
        label: teacher.user.full_name,
        description: teacher.employee_id,
      })),
    },
    {
      id: 'invoices',
      label: t('globalSearch.groups.invoices'),
      isLoading: results.invoices.isLoading,
      results: results.invoices.data.map((invoice) => ({
        id: invoice.id,
        label: invoice.invoice_number,
        description: invoice.student.full_name,
      })),
    },
    {
      id: 'receipts',
      label: t('globalSearch.groups.receipts'),
      isLoading: results.receipts.isLoading,
      results: results.receipts.data.map((receipt) => ({
        id: receipt.id,
        label:
          receipt.transaction_reference ??
          t('globalSearch.receiptFallbackLabel', { amount: receipt.total_amount }),
        description: receipt.student.full_name,
      })),
    },
  ];

  function handleSelect(groupId: string, resultId: string) {
    if (groupId === 'students') {
      void navigate({ to: '/students/$studentId', params: { studentId: resultId } });
      return;
    }
    if (groupId === 'guardians') {
      const guardian = results.guardians.data.find((item) => item.id === resultId);
      const firstStudent = guardian?.students[0];
      if (firstStudent) {
        void navigate({ to: '/students/$studentId', params: { studentId: firstStudent.id } });
      }
      return;
    }
    if (groupId === 'invoices') {
      void navigate({ to: '/invoices/$invoiceId', params: { invoiceId: resultId } });
      return;
    }
    if (groupId === 'receipts') {
      const receipt = results.receipts.data.find((item) => item.id === resultId);
      if (receipt) {
        void navigate({ to: '/students/$studentId', params: { studentId: receipt.student.id } });
      }
      return;
    }
    // 'teachers' — no destination page exists yet, see this file's own
    // header comment.
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t('globalSearch.buttonLabel')}
      </Button>
      <GlobalSearch
        open={open}
        onOpenChange={setOpen}
        query={query}
        onQueryChange={setQuery}
        groups={groups}
        onSelect={handleSelect}
        aria-label={t('globalSearch.ariaLabel')}
        title={t('globalSearch.title')}
        placeholder={t('globalSearch.placeholder')}
        description={t('globalSearch.description')}
        searchableHint={t('globalSearch.searchableHint')}
        noResultsText={(searchQuery) => t('globalSearch.noResults', { query: searchQuery })}
        announceResults={(count) =>
          count === 1
            ? t('globalSearch.resultCount', { count })
            : t('globalSearch.resultCountPlural', { count })
        }
      />
    </>
  );
}
