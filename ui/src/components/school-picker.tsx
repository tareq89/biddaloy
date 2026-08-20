/**
 * The living version of the "Biddaloy Client UI" design project's
 * `templates/school-picker` mockup (approved for [8.9.5] — see
 * `ui/CONTRIBUTING.md`'s "Design before you build"). Presentational only,
 * no network and no `switchActiveTenant` call inside it: the caller
 * (`client-admin/src/routes/select-school.tsx`) owns the actual tenant
 * switch and where to navigate afterward, the same split
 * `SignInForm`/`login.tsx` already use.
 *
 * "Large labelled buttons, not `<select>`" (the AC's own wording) — built
 * from `RadioGroup`/`RadioGroupItem` (`./radio.tsx`), same tested
 * keyboard-operable WAI-ARIA radio-group pattern as `radio.test.tsx`. The
 * accessible *name* still comes from each dot's own `aria-label`, exactly
 * like every other `RadioGroupItem` consumer in this package — nesting a
 * `<label>` around a `<button role="radio">` doesn't create a real name
 * association (see `radio.test.tsx`'s own comment) — but the *card*
 * itself is a real `<label htmlFor>` pointing at that button by `id`,
 * which is a different, valid mechanism: a button is a labelable element
 * per the HTML spec, so clicking anywhere in the label forwards a real
 * click to it, making the whole card a click target without a bare
 * `<div onClick>` standing in for a control jsx-a11y (rightly) flags.
 */
import type { UserRole } from '@biddaloy/shared';
import * as React from 'react';

import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

import { Button } from './button';
import { RadioGroup, RadioGroupItem } from './radio';

export interface SchoolPickerOption {
  tenantId: string;
  name: string;
  role: UserRole;
}

export interface SchoolPickerProps {
  schools: SchoolPickerOption[];
  onSelect: (tenantId: string, role: UserRole) => void;
}

/** Title-cases a role enum key ("TEACHER" -> "Teacher") — not real i18n,
 * just a readable fallback, same convention (and same reasoning) as
 * `status-badge.tsx`'s own `humanize`. Not shared as a util: two four-line
 * copies of a trivial string transform are cheaper to read than an
 * import for this, and each one documents its own "not real i18n yet"
 * caveat right where it's used. */
function humanizeRole(role: string): string {
  const lower = role.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function SchoolCard({ school, selected }: { school: SchoolPickerOption; selected: boolean }) {
  const roleLabel = humanizeRole(school.role);
  const controlId = `school-picker-option-${school.tenantId}`;
  return (
    <label
      htmlFor={controlId}
      className={cn(
        'flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-4 transition-colors',
        selected ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent',
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{school.name}</span>
        <span className="text-sm text-muted-foreground">{roleLabel}</span>
      </div>
      <RadioGroupItem
        id={controlId}
        value={school.tenantId}
        aria-label={`${school.name}, ${roleLabel}`}
      />
    </label>
  );
}

export function SchoolPicker({ schools, onSelect }: SchoolPickerProps) {
  const { t } = useTranslation('auth');
  const [value, setValue] = React.useState<string | null>(schools[0]?.tenantId ?? null);

  function handleSubmit(): void {
    const chosen = schools.find((school) => school.tenantId === value);
    if (chosen) onSelect(chosen.tenantId, chosen.role);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-xl font-semibold text-balance">{t('schoolPicker.heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('schoolPicker.subtext')}</p>
      </div>

      <RadioGroup
        aria-label={t('schoolPicker.heading')}
        value={value}
        onValueChange={setValue}
        className="flex flex-col gap-2"
      >
        {schools.map((school) => (
          <SchoolCard key={school.tenantId} school={school} selected={school.tenantId === value} />
        ))}
      </RadioGroup>

      <Button onClick={handleSubmit} disabled={!value}>
        {t('schoolPicker.continue')}
      </Button>
    </div>
  );
}
