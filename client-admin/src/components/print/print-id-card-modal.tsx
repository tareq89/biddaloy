/**
 * [32.4.2] "Print ID card" from the command palette (D32): choose Student or Staff, then
 * either pick people by name or (students only) a whole class section, and go to the print
 * preview. Shown by `/print/preview` when it is opened with nobody chosen yet.
 */
import { Permission, PrintSubjectType } from '@biddaloy/shared';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@biddaloy/ui/components';
import {
  useClasses,
  useClassSections,
  useHasPermission,
  useStudents,
  useUsers,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

/** What the modal decided. `ids` is a comma list of student ids (students) or user ids (staff). */
export type PrintIdCardChoice =
  | { subjectType: PrintSubjectType; ids: string }
  | { subjectType: 'STUDENT'; classSectionId: string };

export interface PrintIdCardModalProps {
  open: boolean;
  initialType: PrintSubjectType;
  onCancel: () => void;
  onConfirm: (choice: PrintIdCardChoice) => void;
}

const PICK_LIMIT = 20;

export function PrintIdCardModal({
  open,
  initialType,
  onCancel,
  onConfirm,
}: PrintIdCardModalProps) {
  const { t } = useTranslation('printPreview');
  // D18: a staff card exposes HR data, so the Staff choice needs STAFF_HR_READ.
  const canPrintStaff = useHasPermission(Permission.STAFF_HR_READ);
  const [type, setType] = React.useState<PrintSubjectType>(
    initialType === 'STAFF' && !canPrintStaff ? 'STUDENT' : initialType,
  );
  const [search, setSearch] = React.useState('');
  const [picked, setPicked] = React.useState<Map<string, string>>(new Map());
  const [classId, setClassId] = React.useState('');
  const [sectionId, setSectionId] = React.useState('');

  const students = useStudents(
    { limit: PICK_LIMIT, ...(search.trim() ? { search: search.trim() } : {}) },
    { enabled: type === 'STUDENT' },
  );
  const staff = useUsers({
    limit: PICK_LIMIT,
    ...(search.trim() ? { search: search.trim() } : {}),
  });
  const classes = useClasses();
  const sections = useClassSections(classId || undefined);

  const rows: Array<{ id: string; name: string }> =
    type === 'STUDENT'
      ? (students.data?.data ?? []).map((s) => ({ id: s.id, name: s.full_name }))
      : (staff.data?.data ?? []).map((u) => ({ id: u.id, name: u.full_name }));

  function toggle(id: string, name: string) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, name);
      return next;
    });
  }

  function switchType(next: PrintSubjectType) {
    setType(next);
    setPicked(new Map());
    setSearch('');
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent>
        <DialogHeader>
          {/* This modal IS the page (the route shows nothing behind it), so its title is the page's h1. */}
          <DialogTitle asChild>
            <h1>{t('picker.title')}</h1>
          </DialogTitle>
        </DialogHeader>

        <div role="group" aria-label={t('picker.who')} className="flex gap-2">
          {(['STUDENT', 'STAFF'] as const)
            .filter((value) => value === 'STUDENT' || canPrintStaff)
            .map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={type === value ? 'default' : 'outline'}
                aria-pressed={type === value}
                onClick={() => switchType(value)}
              >
                {t(`picker.type.${value}`)}
              </Button>
            ))}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="print-picker-search" className="text-sm font-medium">
            {t('picker.search')}
          </label>
          <Input
            id="print-picker-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <ul className="flex max-h-56 flex-col gap-1 overflow-auto" aria-label={t('picker.results')}>
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                id={`pick-${row.id}`}
                checked={picked.has(row.id)}
                onCheckedChange={() => toggle(row.id, row.name)}
              />
              <label htmlFor={`pick-${row.id}`}>{row.name}</label>
            </li>
          ))}
        </ul>
        {picked.size > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('picker.selected', { count: picked.size })}
          </p>
        ) : null}

        {type === 'STUDENT' ? (
          <fieldset className="flex flex-col gap-2 border-t border-border-subtle pt-3">
            <legend className="text-sm font-medium">{t('picker.wholeSection')}</legend>
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label={t('picker.class')}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={classId}
                onChange={(e) => {
                  setClassId(e.target.value);
                  setSectionId('');
                }}
              >
                <option value="">{t('picker.classPlaceholder')}</option>
                {(classes.data?.data ?? []).map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('picker.section')}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={sectionId}
                disabled={classId === ''}
                onChange={(e) => setSectionId(e.target.value)}
              >
                <option value="">{t('picker.sectionPlaceholder')}</option>
                {(sections.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.section_name}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('picker.cancel')}
          </Button>
          {type === 'STUDENT' && sectionId !== '' ? (
            <Button
              type="button"
              onClick={() => onConfirm({ subjectType: 'STUDENT', classSectionId: sectionId })}
            >
              {t('picker.printSection')}
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={picked.size === 0}
            onClick={() => onConfirm({ subjectType: type, ids: [...picked.keys()].join(',') })}
          >
            {t('picker.continue', { count: picked.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
