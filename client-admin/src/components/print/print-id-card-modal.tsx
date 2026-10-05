/**
 * [32.4.2] "Print ID card" from the command palette (D32): choose Student or Staff, then
 * either pick people by name or (students only) a whole class section, and go to the print
 * preview. Shown by `/print/preview` when it is opened with nobody chosen yet. A full-page
 * modal (D22/D23): Close top right, actions in the footer.
 */
import { Permission, PrintSubjectType } from '@biddaloy/shared';
import {
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@biddaloy/ui/components';
import {
  useClasses,
  useClassSections,
  useHasPermission,
  useStudents,
  usersQueryOptions,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { BriefcaseIcon, GraduationCapIcon, SearchIcon, XIcon } from 'lucide-react';
import * as React from 'react';

/** What the modal decided. `ids` is a comma list of student ids (students) or user ids (staff). */
export type PrintIdCardChoice =
  | { subjectType: PrintSubjectType; ids: string }
  | { subjectType: 'STUDENT'; classSectionId: string };

export interface PrintIdCardModalProps {
  initialType: PrintSubjectType;
  onClose: () => void;
  onConfirm: (choice: PrintIdCardChoice) => void;
}

type Mode = 'names' | 'section';

const PICK_LIMIT = 20;

export function PrintIdCardModal({ initialType, onClose, onConfirm }: PrintIdCardModalProps) {
  const { t } = useTranslation('printPreview');
  const { t: tc } = useTranslation('common');
  const region = useRegionConfig();
  // D18: a staff card exposes HR data, so the Staff choice needs STAFF_HR_READ.
  const canPrintStaff = useHasPermission(Permission.STAFF_HR_READ);
  const [chosenType, setType] = React.useState<PrintSubjectType>(initialType);
  const [mode, setMode] = React.useState<Mode>('names');
  const [search, setSearch] = React.useState('');
  const [picked, setPicked] = React.useState<Map<string, string>>(new Map());
  const [classId, setClassId] = React.useState('');
  const [sectionId, setSectionId] = React.useState('');
  const [discarding, setDiscarding] = React.useState(false);

  // Staff without (or no longer with) STAFF_HR_READ: fall back to Students and drop what was
  // chosen for Staff. `type` is derived so no query ever sees STAFF in the meantime; the state
  // reset below is React's supported adjust-state-during-render pattern (no effect, no flash).
  const type: PrintSubjectType = chosenType === 'STAFF' && !canPrintStaff ? 'STUDENT' : chosenType;
  if (chosenType === 'STAFF' && !canPrintStaff) {
    setType('STUDENT');
    setPicked(new Map());
    setSearch('');
  }
  // Staff have no "whole section".
  const activeMode: Mode = type === 'STAFF' ? 'names' : mode;

  const students = useStudents(
    { limit: PICK_LIMIT, ...(search.trim() ? { search: search.trim() } : {}) },
    { enabled: type === 'STUDENT' },
  );
  // Staff are listed only on the Staff tab: this modal opens on Students, and /users needs a
  // permission a student-only printer may not have.
  const staff = useQuery({
    ...usersQueryOptions({
      limit: PICK_LIMIT,
      ...(search.trim() ? { search: search.trim() } : {}),
    }),
    enabled: type === 'STAFF',
  });
  const classes = useClasses();
  const sections = useClassSections(classId || undefined);

  const rows: Array<{ id: string; name: string; caption?: string }> =
    type === 'STUDENT'
      ? (students.data?.data ?? []).map((s) => ({
          id: s.id,
          name: s.full_name,
          caption: s.registration_number,
        }))
      : (staff.data?.data ?? []).map((u) => ({ id: u.id, name: u.full_name }));

  function toggle(id: string, name: string) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, name);
      return next;
    });
  }

  function switchType(next: string) {
    setType(next as PrintSubjectType);
    setPicked(new Map());
    setSearch('');
  }

  const dirty = picked.size > 0 || sectionId !== '';
  // The shell's footer `secondary` bypasses its own close guard, so Cancel asks here.
  const cancel = () => (dirty ? setDiscarding(true) : onClose());

  const primary =
    activeMode === 'names'
      ? {
          label: t('picker.continue', { count: picked.size, n: formatNumber(picked.size, region) }),
          disabled: picked.size === 0,
          onClick: () => onConfirm({ subjectType: type, ids: [...picked.keys()].join(',') }),
        }
      : {
          label: t('picker.continueSection'),
          disabled: sectionId === '',
          onClick: () => onConfirm({ subjectType: 'STUDENT', classSectionId: sectionId }),
        };

  return (
    <FullPageShell
      title={t('picker.title')}
      size="form"
      onClose={onClose}
      dirty={dirty}
      secondary={{ label: t('picker.cancel'), onClick: cancel }}
      primary={primary}
    >
      <Card padded className="space-y-4">
        <Tabs value={type} onValueChange={switchType}>
          <TabsList variant="line" aria-label={t('picker.who')}>
            <TabsTrigger value="STUDENT" className="h-11 md:h-auto">
              <GraduationCapIcon aria-hidden />
              {t('picker.type.STUDENT')}
            </TabsTrigger>
            {canPrintStaff ? (
              <TabsTrigger value="STAFF" className="h-11 md:h-auto">
                <BriefcaseIcon aria-hidden />
                {t('picker.type.STAFF')}
              </TabsTrigger>
            ) : null}
          </TabsList>
        </Tabs>

        {type === 'STUDENT' ? (
          <div>
            <p className="text-label" id="print-picker-mode">
              {t('picker.modeLabel')}
            </p>
            <RadioGroup
              aria-labelledby="print-picker-mode"
              value={mode}
              onValueChange={(v) => setMode(v as Mode)}
              className="mt-1.5 grid gap-2 md:grid-cols-2"
            >
              {(['names', 'section'] as const).map((value) => (
                <label
                  key={value}
                  htmlFor={`print-picker-mode-${value}`}
                  className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 ${
                    mode === value
                      ? 'border-primary bg-secondary'
                      : 'border-border-subtle bg-surface hover:bg-muted'
                  }`}
                >
                  <RadioGroupItem
                    id={`print-picker-mode-${value}`}
                    value={value}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium">
                      {value === 'names' ? t('picker.modeNames') : t('picker.modeSection')}
                    </span>
                    <span className="block text-caption text-text-secondary">
                      {value === 'names' ? t('picker.modeNamesHelp') : t('picker.modeSectionHelp')}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>
        ) : null}
      </Card>

      {activeMode === 'names' ? (
        <Card padded>
          <h2 className="text-h2">{t('picker.namesTitle')}</h2>
          <p className="mt-1 text-text-secondary">{t('picker.namesHelp')}</p>

          <div className="mt-4 flex flex-col gap-1.5">
            <label htmlFor="print-picker-search" className="text-label">
              {t('picker.search')}
            </label>
            <div className="relative">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
              />
              <Input
                id="print-picker-search"
                className="ps-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {picked.size > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-label">
                {t('picker.pickedLabel', {
                  count: picked.size,
                  n: formatNumber(picked.size, region),
                })}
              </span>
              {[...picked.entries()].map(([id, name]) => (
                <button
                  key={id}
                  type="button"
                  aria-label={t('picker.removePicked', { name })}
                  onClick={() => toggle(id, name)}
                  className="inline-flex h-11 items-center gap-1 rounded-full bg-secondary px-3 text-label text-secondary-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:h-8"
                >
                  {name}
                  <XIcon className="size-3.5" aria-hidden />
                </button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11 md:h-8"
                onClick={() => setPicked(new Map())}
              >
                {t('picker.clearPicked')}
              </Button>
            </div>
          ) : null}

          <ul
            className="mt-3 divide-y divide-border-subtle rounded-md border border-border-subtle"
            aria-label={t('picker.results')}
          >
            {rows.map((row) => (
              <li key={row.id}>
                <label
                  htmlFor={`pick-${row.id}`}
                  className="flex min-h-11 cursor-pointer items-center gap-3 px-3 hover:bg-muted md:min-h-10"
                >
                  <Checkbox
                    id={`pick-${row.id}`}
                    checked={picked.has(row.id)}
                    onCheckedChange={() => toggle(row.id, row.name)}
                  />
                  <span className="font-medium">{row.name}</span>
                  {row.caption ? (
                    <span className="text-caption text-text-secondary">{row.caption}</span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
          {rows.length === PICK_LIMIT ? (
            <p className="mt-2 text-caption text-text-secondary">
              {t('picker.limitHelp', { limit: formatNumber(PICK_LIMIT, region) })}
            </p>
          ) : null}
        </Card>
      ) : (
        <Card padded>
          <h2 className="text-h2">{t('picker.sectionTitle')}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-label" id="print-picker-class">
                {t('picker.class')}
              </span>
              <Select
                value={classId}
                onValueChange={(v) => {
                  setClassId(v);
                  setSectionId('');
                }}
              >
                <SelectTrigger aria-labelledby="print-picker-class" className="w-full">
                  <SelectValue placeholder={t('picker.classPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {(classes.data?.data ?? []).map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-label" id="print-picker-section">
                {t('picker.section')}
              </span>
              <Select value={sectionId} onValueChange={setSectionId} disabled={classId === ''}>
                <SelectTrigger aria-labelledby="print-picker-section" className="w-full">
                  <SelectValue placeholder={t('picker.sectionPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {(sections.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.section_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        tone="danger"
        title={tc('fullPage.discardTitle')}
        description={tc('fullPage.discardDescription')}
        confirmLabel={tc('fullPage.discardConfirm')}
        cancelLabel={tc('fullPage.keepEditing')}
        onConfirm={() => {
          setDiscarding(false);
          onClose();
        }}
      />
    </FullPageShell>
  );
}
