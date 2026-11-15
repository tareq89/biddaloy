/**
 * [67.5.05] "Who gets it": four checkbox groups (roles, students of sections,
 * guardians of sections, named people). A checked group shows its chips and an
 * "add" combobox. The value is the `ManualAudience` the server takes.
 */
import { Permission, UserRole } from '@biddaloy/shared';
import { Checkbox, Combobox, type ComboboxOption } from '@biddaloy/ui/components';
import {
  useDebouncedValue,
  useHasPermission,
  useUsers,
  type ManualAudience,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { XIcon } from 'lucide-react';
import * as React from 'react';

import { useSectionOptions } from '../use-section-options';

type GroupKey = 'roles' | 'sectionIds' | 'guardiansOfSectionIds' | 'userIds';

export interface AudiencePickerProps {
  value: ManualAudience;
  onChange: (next: ManualAudience) => void;
  /** Called when a named person is picked, with their role, so the form can limit the link list. */
  onPersonPicked?: (id: string, role: string) => void;
}

const ROLES = Object.values(UserRole).filter((r) => r !== UserRole.SUPER_ADMIN);

export function AudiencePicker({ value, onChange, onPersonPicked }: AudiencePickerProps) {
  const { t } = useTranslation('attention');
  const [opened, setOpened] = React.useState<Partial<Record<GroupKey, boolean>>>({});
  const sectionOptions = useSectionOptions();
  // The "Named people" box asks the server (name, email or phone) as you type.
  const [userQuery, setUserQuery] = React.useState('');
  const q = useDebouncedValue(userQuery, 300).trim();
  // Finding named people lists users (USER_READ). A role without it (a principal) would get a 403, so the
  // request is not sent and the named-people group is not offered (#2514).
  const canFindPeople = useHasPermission(Permission.USER_READ);
  const users = useUsers({ limit: 100, ...(q ? { search: q } : {}) }, { enabled: canFindPeople });
  // Until the typed text's search has answered, list nobody: the previous
  // list (debounce pending, or kept as placeholder data while the request is
  // in flight) does not match what was typed, and Enter would pick its first row.
  const searching = userQuery.trim() !== q || users.isPending || users.isPlaceholderData;
  // A new search replaces the options, so remember each picked person's label.
  const [pickedLabels, setPickedLabels] = React.useState<Record<string, string>>({});
  const userOptions: ComboboxOption[] = searching
    ? []
    : (users.data?.data ?? []).map((u) => ({
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
    ...(canFindPeople
      ? [
          {
            key: 'userIds' as const,
            title: t('composer.namedPeople'),
            addLabel: t('composer.findPerson'),
            options: userOptions,
          },
        ]
      : []),
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
                      const label =
                        (key === 'userIds' ? pickedLabels[id] : undefined) ??
                        options.find((o) => o.value === id)?.label ??
                        id;
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
                  {...(key === 'userIds'
                    ? {
                        onQueryChange: setUserQuery,
                        ...(searching ? { emptyText: t('status.loading', { ns: 'common' }) } : {}),
                      }
                    : {})}
                  onValueChange={(next) => {
                    if (!next) return;
                    if (key === 'userIds') {
                      const picked = options.find((o) => o.value === next)?.label;
                      if (picked) setPickedLabels((prev) => ({ ...prev, [next]: picked }));
                      const person = users.data?.data.find((u) => u.id === next);
                      if (person?.role) onPersonPicked?.(next, person.role);
                    }
                    set(key, [...ids, next]);
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
