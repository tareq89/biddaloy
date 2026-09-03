import { Permission } from '@biddaloy/shared';
import { REGION_BD_BN, REGION_BD_EN, type RegionConfig } from '@biddaloy/ui/i18n';
import { describe, expect, it } from 'vitest';

import {
  auditEntityRoute,
  changedFieldCount,
  diffFields,
  humanizeFieldName,
  humanizeValue,
  isEventOnly,
  shortEntityId,
  type HumanizeOptions,
} from './-humanize';

function options(config: RegionConfig = REGION_BD_EN): HumanizeOptions {
  return {
    config,
    emptyValue: '—',
    trueLabel: 'Yes',
    falseLabel: 'No',
    // Stand-in for the panel's i18n lookup — these units are deliberately
    // i18next-free, so the label function is injected.
    fieldLabel: (key) => humanizeFieldName(key),
  };
}

describe('diffFields', () => {
  it('unions both snapshots, old_values order first', () => {
    const fields = diffFields({ full_name: 'Rahim', gender: 'M' }, { full_name: 'Rahim Uddin' });

    expect(fields.map((field) => field.key)).toEqual(['full_name', 'gender']);
  });

  it('appends keys only the new snapshot introduced', () => {
    const fields = diffFields({ full_name: 'Rahim' }, { full_name: 'Rahim', roll_number: 12 });

    expect(fields.map((field) => field.key)).toEqual(['full_name', 'roll_number']);
  });

  it('marks a field changed only when its value actually differs', () => {
    const fields = diffFields(
      { full_name: 'Rahim', roll_number: 12 },
      { full_name: 'Rahim Uddin', roll_number: 12 },
    );

    expect(fields.find((field) => field.key === 'full_name')?.changed).toBe(true);
    expect(fields.find((field) => field.key === 'roll_number')?.changed).toBe(false);
  });

  // A field that appeared or disappeared between snapshots is exactly what
  // a dispute turns on — it must not read as "unchanged".
  it('treats a key present in only one snapshot as changed', () => {
    const fields = diffFields({ note: 'old' }, {});

    expect(fields[0]?.changed).toBe(true);
    expect(fields[0]?.before).toBe('old');
    expect(fields[0]?.after).toBeUndefined();
  });

  // Key order is an artifact of how the server serialized the row, not a
  // real difference — two structurally identical objects are unchanged.
  it('compares nested structures by value, not by reference or key order', () => {
    const fields = diffFields({ meta: { a: 1, b: [1, 2] } }, { meta: { b: [1, 2], a: 1 } });

    expect(fields[0]?.changed).toBe(false);
  });

  it('detects a difference inside a nested array', () => {
    const fields = diffFields({ meta: { b: [1, 2] } }, { meta: { b: [1, 3] } });

    expect(fields[0]?.changed).toBe(true);
  });

  it('treats a null snapshot as an empty one', () => {
    expect(diffFields(null, { name: 'Monthly Tuition' }).map((f) => f.key)).toEqual(['name']);
    expect(diffFields({ name: 'Monthly Tuition' }, null)[0]?.changed).toBe(true);
  });
});

describe('changedFieldCount', () => {
  it('counts only the fields that actually moved', () => {
    expect(
      changedFieldCount(
        { full_name: 'Rahim', roll_number: 12, gender: 'M' },
        { full_name: 'Rahim Uddin', roll_number: 13, gender: 'M' },
      ),
    ).toBe(2);
  });

  it('is zero when both snapshots are absent', () => {
    expect(changedFieldCount(null, null)).toBe(0);
  });
});

describe('isEventOnly', () => {
  // LOGIN/LOGOUT/LOGIN_FAILED/TOKEN_REUSE_DETECTED rows carry no snapshots
  // at all — the panel says so rather than rendering an empty table.
  it('is true when neither snapshot has any field', () => {
    expect(isEventOnly(null, null)).toBe(true);
    expect(isEventOnly({}, {})).toBe(true);
  });

  it('is false as soon as either snapshot has a field', () => {
    expect(isEventOnly(null, { created: 42 })).toBe(false);
  });
});

describe('humanizeFieldName', () => {
  it('sentence-cases a snake_case column name', () => {
    expect(humanizeFieldName('full_name')).toBe('Full name');
    expect(humanizeFieldName('preferred_communication')).toBe('Preferred communication');
  });

  it('splits a camelCase column name', () => {
    expect(humanizeFieldName('dueDate')).toBe('Due date');
  });

  it('keeps an id segment upper-cased', () => {
    expect(humanizeFieldName('academic_year_id')).toBe('Academic year ID');
  });

  it('returns the key unchanged when there is nothing to split', () => {
    expect(humanizeFieldName('')).toBe('');
  });
});

describe('humanizeValue', () => {
  it('renders null and undefined as the empty marker', () => {
    expect(humanizeValue(null, options())).toEqual(['—']);
    expect(humanizeValue(undefined, options())).toEqual(['—']);
  });

  it('renders an empty string as the empty marker too', () => {
    expect(humanizeValue('', options())).toEqual(['—']);
  });

  it('renders booleans as Yes/No, never as true/false', () => {
    expect(humanizeValue(true, options())).toEqual(['Yes']);
    expect(humanizeValue(false, options())).toEqual(['No']);
  });

  it('formats numbers through the region config', () => {
    expect(humanizeValue(1500, options())).toEqual(['1,500']);
    expect(humanizeValue(12.5, options())).toEqual(['12.5']);
  });

  // The whole point of RegionConfig: a Bangla-locale reader sees Bengali
  // numerals, from the same helper, with no branch in the panel.
  it('renders numbers in Bengali numerals for a Bangla region config', () => {
    expect(humanizeValue(1500, options(REGION_BD_BN))).toEqual(['১,৫০০']);
  });

  it('formats a date-only string as a date', () => {
    expect(humanizeValue('2026-01-05', options())).toEqual(['2026-01-05']);
  });

  // Keeps the time. Rendering a full timestamp as a bare date would make
  // two same-day values look identical in the Before and After cells while
  // the row is still marked "Changed" — the panel contradicting itself
  // about the one change it exists to show. `Asia/Dhaka` is UTC+6, so
  // 10:30Z is 16:30 on the school's clock.
  it('formats an ISO datetime string with its time of day', () => {
    expect(humanizeValue('2026-01-05T10:30:00.000Z', options())).toEqual(['2026-01-05 16:30']);
  });

  it('keeps two same-day timestamps distinguishable', () => {
    const before = humanizeValue('2026-01-05T04:30:00.000Z', options());
    const after = humanizeValue('2026-01-05T12:00:00.000Z', options());
    expect(before).toEqual(['2026-01-05 10:30']);
    expect(after).toEqual(['2026-01-05 18:00']);
    expect(before).not.toEqual(after);
  });

  it('leaves a timestamp on an impossible calendar date alone', () => {
    expect(humanizeValue('2026-02-30T10:30:00.000Z', options())).toEqual([
      '2026-02-30T10:30:00.000Z',
    ]);
  });

  it('leaves a date-shaped string that is not a real date alone', () => {
    expect(humanizeValue('2026-02-30', options())).toEqual(['2026-02-30']);
  });

  it('passes an ordinary string through untouched', () => {
    expect(humanizeValue('Rahim Uddin', options())).toEqual(['Rahim Uddin']);
  });

  it('flattens a one-level object into labelled lines', () => {
    expect(humanizeValue({ full_name: 'Rahim', is_active: false }, options())).toEqual([
      'Full name: Rahim',
      // The generic fallback label — the panel's own i18n map turns
      // `is_active` into "Active"; this unit injects the fallback.
      'Is active: No',
    ]);
  });

  // Deeper than one level is rare and has no good sentence form — a
  // compact single line is still far short of dumping the whole record.
  it('falls back to compact JSON for a value nested more than one level', () => {
    expect(humanizeValue({ meta: { a: 1 } }, options())).toEqual(['Meta: {"a":1}']);
  });

  it('renders each array item on its own line', () => {
    expect(humanizeValue(['SMS', 'EMAIL'], options())).toEqual(['SMS', 'EMAIL']);
  });

  it('renders an empty array and an empty object as the empty marker', () => {
    expect(humanizeValue([], options())).toEqual(['—']);
    expect(humanizeValue({}, options())).toEqual(['—']);
  });
});

describe('shortEntityId', () => {
  it('keeps only the first UUID segment', () => {
    expect(shortEntityId('3f2a1b4c-1111-2222-3333-444455556666')).toBe('3f2a1b4c');
  });

  it('is null when the row has no entity id', () => {
    expect(shortEntityId(null)).toBeNull();
  });
});

describe('auditEntityRoute', () => {
  it('maps Student to the student detail route, gated on STUDENT_READ', () => {
    expect(auditEntityRoute('Student')).toEqual({
      to: '/students/$studentId',
      paramKey: 'studentId',
      permission: Permission.STUDENT_READ,
    });
  });

  it('maps Invoice to the invoice detail route, gated on INVOICE_READ', () => {
    expect(auditEntityRoute('Invoice')).toEqual({
      to: '/invoices/$invoiceId',
      paramKey: 'invoiceId',
      permission: Permission.INVOICE_READ,
    });
  });

  it('maps User to the staff detail route, gated on USER_READ', () => {
    expect(auditEntityRoute('User')).toEqual({
      to: '/staff/$userId',
      paramKey: 'userId',
      permission: Permission.USER_READ,
    });
  });

  it('maps ReminderBatch to the batch detail route, gated on COMMUNICATION_BULK_SEND', () => {
    expect(auditEntityRoute('ReminderBatch')).toEqual({
      to: '/communications/batches/$batchId',
      paramKey: 'batchId',
      permission: Permission.COMMUNICATION_BULK_SEND,
    });
  });

  // FeeStructure, School, and ReminderBatchPreview have no detail route in
  // client-admin — see -humanize.ts's own comment on why. Payment is the
  // same case, even though the issue asked for it: no /payments/:id route
  // exists to link to.
  it.each(['Payment', 'FeeStructure', 'School', 'ReminderBatchPreview'])(
    'has no route for %s',
    (entityType) => {
      expect(auditEntityRoute(entityType)).toBeNull();
    },
  );
});
