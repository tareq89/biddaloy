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
  name?: string;
  role: UserRole;
}

export interface SchoolPickerProps {
  schools: SchoolPickerOption[];
  onSelect: (tenantId: string, role: UserRole) => void;
}

/** A membership's identity is the `{tenantId, role}` pair, not the tenant —
 * one user can be ADMIN *and* PARENT at the same school ([8.9.11]). Keying
 * cards or radio values on `tenantId` alone gave those two memberships a
 * duplicate React key and an identical `RadioGroupItem value`, so the radio
 * group couldn't tell them apart and `handleSubmit`'s lookup always resolved
 * to whichever one the token listed first. */
function optionKey(school: SchoolPickerOption): string {
  return `${school.tenantId}:${school.role}`;
}

function SchoolCard({ school, selected }: { school: SchoolPickerOption; selected: boolean }) {
  const { t } = useTranslation('auth');
  // A stale token from before `JwtMembership.name` existed can still be
  // valid for up to its remaining lifetime — fall back rather than render
  // blank text. Every `UserRole` value has a translated
  // `schoolPicker.roles.*` key (`auth.json`), unlike `tenant-bar.tsx`'s own
  // still-English-only `humanizeRole` — see that file's comment.
  const displayName = school.name ?? t('schoolPicker.unnamedSchool');
  const roleLabel = t(`schoolPicker.roles.${school.role}`);
  const controlId = `school-picker-option-${optionKey(school)}`;
  return (
    <label
      htmlFor={controlId}
      className={cn(
        'flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-4 transition-colors',
        selected ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent',
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{displayName}</span>
        <span className="text-sm text-muted-foreground">{roleLabel}</span>
      </div>
      <RadioGroupItem
        id={controlId}
        value={optionKey(school)}
        aria-label={`${displayName}, ${roleLabel}`}
      />
    </label>
  );
}

export function SchoolPicker({ schools, onSelect }: SchoolPickerProps) {
  const { t } = useTranslation('auth');
  const [value, setValue] = React.useState<string | null>(
    schools[0] ? optionKey(schools[0]) : null,
  );

  function handleSubmit(): void {
    const chosen = schools.find((school) => optionKey(school) === value);
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
          <SchoolCard
            key={optionKey(school)}
            school={school}
            selected={optionKey(school) === value}
          />
        ))}
      </RadioGroup>

      <Button onClick={handleSubmit} disabled={!value}>
        {t('schoolPicker.continue')}
      </Button>
    </div>
  );
}
