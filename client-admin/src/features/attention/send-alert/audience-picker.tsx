/**
 * [67.5.05] "Who gets it": four checkbox groups (roles, students of sections,
 * guardians of sections, named people). A checked group shows its chips and an
 * "add" combobox. The value is the `ManualAudience` the server takes.
 */
import { UserRole } from '@biddaloy/shared';
import { Checkbox, Combobox, type ComboboxOption } from '@biddaloy/ui/components';
import {
  classSectionsQueryOptions,
  useAllClasses,
  useUsers,
  type ManualAudience,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQueries } from '@tanstack/react-query';
import { XIcon } from 'lucide-react';
import * as React from 'react';

type GroupKey = 'roles' | 'sectionIds' | 'guardiansOfSectionIds' | 'userIds';

export interface AudiencePickerProps {
  value: ManualAudience;
  onChange: (next: ManualAudience) => void;
}

const ROLES = Object.values(UserRole).filter((r) => r !== UserRole.SUPER_ADMIN);

/** "Class – Section" options for every section of every class. */
function useSectionOptions(): ComboboxOption[] {
  const classes = useAllClasses();
  const sections = useQueries({
    queries: (classes.data ?? []).map((klass) => classSectionsQueryOptions(klass.id)),
  });
  return (classes.data ?? []).flatMap((klass, i) =>
    (sections[i]?.data ?? []).map((s) => ({
      value: s.id,
      label: `${klass.name} – ${s.section_name}`,
    })),
  );
}

export function AudiencePicker({ value, onChange }: AudiencePickerProps) {
  const { t } = useTranslation('attention');
  const [opened, setOpened] = React.useState<Partial<Record<GroupKey, boolean>>>({});
  const sectionOptions = useSectionOptions();
  // ponytail: first 100 staff, filtered in the combobox; add server search past that.
  const users = useUsers({ limit: 100 });
  const userOptions: ComboboxOption[] = (users.data?.data ?? []).map((u) => ({
    value: u.id,
    label: u.role ? `${u.full_name} · ${t(`roles.${u.role}`)}` : u.full_name,
  }));
  const roleOptions: ComboboxOption[] = ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }));

  const groups: {
    key: GroupKey;
    title: string;
    addLabel: string;
    options: ComboboxOption[];
  }[] = [
    {
      key: 'roles',
      title: t('composer.byRole'),
      addLabel: t('composer.addRole'),
      options: roleOptions,
    },
    {
      key: 'sectionIds',
      title: t('composer.studentsOfSections'),
      addLabel: t('composer.addSection'),
      options: sectionOptions,
    },
    {
      key: 'guardiansOfSectionIds',
      title: t('composer.guardiansOfSections'),
      addLabel: t('composer.addSection'),
      options: sectionOptions,
    },
    {
      key: 'userIds',
      title: t('composer.namedPeople'),
      addLabel: t('composer.findPerson'),
      options: userOptions,
    },
  ];

  const set = (key: GroupKey, ids: string[]) => {
    const next: ManualAudience = { ...value };
    if (ids.length > 0) next[key] = ids as never;
    else delete next[key];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ key, title, addLabel, options }) => {
        const ids: string[] = value[key] ?? [];
        const checked = opened[key] === true || ids.length > 0;
        const checkId = `audience-${key}`;
        return (
          <div key={key} className="flex flex-col gap-2">
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox
                id={checkId}
                checked={checked}
                onCheckedChange={(next) => {
                  setOpened((prev) => ({ ...prev, [key]: next === true }));
                  if (next !== true) set(key, []);
                }}
              />
              <label htmlFor={checkId} className="text-label">
                {title}
              </label>
            </div>
            {checked && (
              <div className="flex flex-col gap-2 ps-8">
                {ids.length > 0 && (
                  <ul className="flex flex-wrap gap-2" aria-label={title}>
                    {ids.map((id) => {
                      const label = options.find((o) => o.value === id)?.label ?? id;
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            aria-label={t('composer.removeChip', { label })}
                            onClick={() =>
                              set(
                                key,
                                ids.filter((x) => x !== id),
                              )
                            }
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border-functional bg-muted px-3 text-label hover:bg-secondary md:min-h-8"
                          >
                            {label}
                            <XIcon className="size-3.5" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <Combobox
                  aria-label={addLabel}
                  placeholder={addLabel}
                  options={options.filter((o) => !ids.includes(o.value))}
                  value={null}
                  onValueChange={(next) => {
                    if (next) set(key, [...ids, next]);
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
