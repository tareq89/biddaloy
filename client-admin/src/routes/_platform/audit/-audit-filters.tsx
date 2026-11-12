import { AuditAction } from '@biddaloy/shared';
import { Button, Combobox, DatePicker } from '@biddaloy/ui/components';
import { PLATFORM_USER_SEARCH_MIN, useSchools, usePlatformUserSearch } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { parseDate, toIsoDate } from '@biddaloy/ui/utils';
import * as React from 'react';

import { actionLabel } from './-audit-table';

export interface AuditFilterValues {
  tenantId?: string | undefined;
  action?: string | undefined;
  actorId?: string | undefined;
  sessionId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface AuditFiltersProps {
  value: AuditFilterValues;
  /** Sends only the keys that changed; `undefined` clears one. The page also drops the cursor. */
  onChange: (patch: AuditFilterValues) => void;
}

const CLEARED: AuditFilterValues = {
  tenantId: undefined,
  action: undefined,
  actorId: undefined,
  sessionId: undefined,
  from: undefined,
  to: undefined,
};

const dateOf = (iso: string | undefined) => {
  if (!iso) return undefined;
  try {
    return parseDate(iso);
  } catch {
    return undefined;
  }
};

/** School, action, who, date range, and the one Login as visit being looked at. */
export function AuditFilters({ value, onChange }: AuditFiltersProps) {
  const { t } = useTranslation(['platformAudit', 'auditLogs']);
  const config = useRegionConfig();
  const schools = useSchools();
  const [query, setQuery] = React.useState('');
  const people = usePlatformUserSearch(query);
  // The picked person stays selectable after the search text changes.
  const [picked, setPicked] = React.useState<{ value: string; label: string } | null>(null);

  const schoolOptions = (schools.data ?? []).map((s) => ({ value: s.id, label: s.name }));
  const actionOptions = Object.values(AuditAction).map((a) => ({
    value: a,
    label: actionLabel(t, a),
  }));
  const peopleOptions = (people.data ?? []).map((p) => ({ value: p.userId, label: p.fullName }));
  if (picked && !peopleOptions.some((o) => o.value === picked.value)) peopleOptions.push(picked);

  const filtered = Object.values(value).some((v) => v !== undefined);

  return (
    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
      <Combobox
        aria-label={t('platformAudit:filters.school')}
        placeholder={t('platformAudit:filters.allSchools')}
        emptyText={t('platformAudit:filters.noMatch')}
        options={schoolOptions}
        value={value.tenantId ?? null}
        onValueChange={(v) => onChange({ tenantId: v ?? undefined })}
      />
      <Combobox
        aria-label={t('platformAudit:filters.action')}
        placeholder={t('platformAudit:filters.allActions')}
        emptyText={t('platformAudit:filters.noMatch')}
        options={actionOptions}
        value={value.action ?? null}
        onValueChange={(v) => onChange({ action: v ?? undefined })}
      />
      <Combobox
        aria-label={t('platformAudit:filters.who')}
        placeholder={t('platformAudit:filters.whoPlaceholder', { count: PLATFORM_USER_SEARCH_MIN })}
        emptyText={t('platformAudit:filters.noMatch')}
        options={peopleOptions}
        value={value.actorId ?? null}
        onQueryChange={setQuery}
        onValueChange={(v) => {
          setPicked(v ? (peopleOptions.find((o) => o.value === v) ?? null) : null);
          onChange({ actorId: v ?? undefined });
        }}
      />
      <DatePicker
        aria-label={t('platformAudit:filters.from')}
        config={config}
        value={dateOf(value.from)}
        max={dateOf(value.to)}
        onValueChange={(d) => onChange({ from: d ? toIsoDate(d) : undefined })}
      />
      <DatePicker
        aria-label={t('platformAudit:filters.to')}
        config={config}
        value={dateOf(value.to)}
        min={dateOf(value.from)}
        onValueChange={(d) => onChange({ to: d ? toIsoDate(d) : undefined })}
      />
      {value.sessionId && (
        <Button variant="outline" onClick={() => onChange({ sessionId: undefined })}>
          {t('platformAudit:filters.visit')}: {t('platformAudit:filters.clearVisit')}
        </Button>
      )}
      {filtered && (
        <Button variant="ghost" onClick={() => onChange(CLEARED)}>
          {t('platformAudit:filters.clearAll')}
        </Button>
      )}
    </div>
  );
}
