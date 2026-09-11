import { describe, expect, it } from 'vitest';
import { School } from '../../../schools/entities/school.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { deepMergePresent, schoolTab, stripSecretPaths, type SchoolRow } from './school.tab';
import { schoolTabs } from './index';

const SCHOOL_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const SECRET = 'super-secret-sms-key';

const exportCtx: ExportContext = { keyOf: () => '' };
const importCtx: ImportContext = {
  tenantId: SCHOOL_ID,
  ref: () => undefined,
  warn: () => undefined,
};

function makeSchool(overrides: Partial<School> = {}): School {
  return Object.assign(new School(), {
    id: SCHOOL_ID,
    name: 'Dhaka Model High School',
    slug: 'dhaka-model',
    domain: null,
    address: '12 Green Road, Dhaka',
    phone: '01712345678',
    email: 'office@dhaka-model.test',
    name_bn: 'ঢাকা মডেল উচ্চ বিদ্যালয়',
    registration_id: 'EIIN-108234',
    logo_key: 'schools/dhaka-model/logo.png',
    settings: null,
    status: 'ACTIVE',
    status_reason: null,
    status_changed_at: null,
    ...overrides,
  } satisfies Partial<School>);
}

/**
 * The real pipeline, both directions: `toRow` then `toCell` on the way out
 * (what writeWorkbook does), then `cellText` on the way back in (what
 * readWorkbook's readSheet does). Including the read side is what makes these
 * round-trip tests honest about what a restore actually sees.
 */
function toCells(school: School): Record<string, string> {
  const row = schoolTab.toRow(school, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of schoolTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('schoolTab shape', () => {
  it('is registered through the school barrel', () => {
    expect(schoolTabs).toEqual([schoolTab]);
  });

  it('satisfies the registry contract', () => {
    expect(() => assertRegistryValid([schoolTab])).not.toThrow();
  });

  it('is a single-row tab that a restore never deletes', () => {
    expect(schoolTab.name).toBe('school');
    expect(schoolTab.dependsOn).toEqual([]);
    expect(schoolTab.naturalKey).toEqual(['name']);
    expect(schoolTab.deleteByAbsence).toBe(false);
  });

  it('keys a school by its name', () => {
    expect(schoolTab.keyOf(makeSchool())).toBe('Dhaka Model High School');
  });
});

describe('round trip', () => {
  it('returns equivalent values through toRow then fromRow', () => {
    const school = makeSchool({ settings: { region: { timezone: 'Asia/Dhaka' } } });

    const result = schoolTab.fromRow(toCells(school), 2, importCtx);

    expect(result).toEqual({
      row: {
        id: SCHOOL_ID,
        name: 'Dhaka Model High School',
        name_bn: 'ঢাকা মডেল উচ্চ বিদ্যালয়',
        address: '12 Green Road, Dhaka',
        phone: '01712345678',
        email: 'office@dhaka-model.test',
        registration_id: 'EIIN-108234',
        settings: { region: { timezone: 'Asia/Dhaka' } },
      } satisfies SchoolRow,
    });
  });

  it('round-trips a school whose optional fields are all empty', () => {
    const school = makeSchool({
      name_bn: null,
      address: null,
      phone: null,
      email: null,
      registration_id: null,
      settings: null,
    });

    const result = schoolTab.fromRow(toCells(school), 2, importCtx);

    expect(result).toEqual({
      row: {
        id: SCHOOL_ID,
        name: 'Dhaka Model High School',
        name_bn: null,
        address: null,
        phone: null,
        email: null,
        registration_id: null,
        settings: null,
      } satisfies SchoolRow,
    });
  });

  // Business-critical for a Bangla-first product: a school name containing
  // Bengali numerals must survive a backup unchanged. The generic cell
  // normaliser maps ৫ to 5, which is right for a phone number and wrong for
  // a name, so the mapping happens per column type in fromCell instead.
  it('preserves Bengali digits in prose columns', () => {
    const school = makeSchool({
      name: '৫ নম্বর সরকারি প্রাথমিক বিদ্যালয়',
      address: '১২ গ্রিন রোড, ঢাকা',
    });

    const result = schoolTab.fromRow(toCells(school), 2, importCtx);

    expect(result).toMatchObject({
      row: {
        name: '৫ নম্বর সরকারি প্রাথমিক বিদ্যালয়',
        address: '১২ গ্রিন রোড, ঢাকা',
      },
    });
  });

  it('rejects a settings cell that is not a JSON object', () => {
    for (const bad of ['"hello"', '[1,2]', '5', 'true']) {
      const cells = { ...toCells(makeSchool()), settings: bad };
      const result = schoolTab.fromRow(cells, 2, importCtx);

      expect('errors' in result, `expected ${bad} to be rejected`).toBe(true);
      if (!('errors' in result)) continue;
      expect(result.errors[0].column).toBe('settings');
    }
  });

  it('rejects a value longer than the column allows rather than failing at save', () => {
    const cells = { ...toCells(makeSchool()), phone: '01712345678 / 01812345678' };

    const result = schoolTab.fromRow(cells, 2, importCtx);

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('phone');
    expect(result.errors[0].message).toContain('20 characters');
  });

  it('collects an error naming the column when a required cell is empty', () => {
    const cells = toCells(makeSchool());
    cells.name = '';

    const result = schoolTab.fromRow(cells, 4, importCtx);

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].column).toBe('name');
    expect(result.errors[0].row).toBe(4);
    expect(result.errors[0].tab).toBe('school');
  });
});

describe('secret handling on export', () => {
  // The real `@Secret()` path in TenantSettingsDto is nested under the
  // provider: communications.sms.mimsms.apiKey (the ticket's "sms.apiKey" is
  // shorthand). Driving off getSecretPaths means this keeps working when the
  // schema gains another credential.
  const withSecret = {
    region: { timezone: 'Asia/Dhaka' },
    communications: {
      sms: { provider: 'mimsms', mimsms: { apiKey: SECRET, senderId: 'BIDDALOY' } },
    },
  };

  it('does not put a secret value in the exported JSON', () => {
    const cells = toCells(makeSchool({ settings: withSecret }));

    expect(cells.settings).not.toContain(SECRET);
    // The non-secret siblings must survive.
    expect(cells.settings).toContain('BIDDALOY');
    expect(cells.settings).toContain('Asia/Dhaka');
  });

  it('removes the secret key rather than masking it', () => {
    // A [REDACTED] marker would merge back over the destination's real
    // credential on import and break its SMS integration.
    const stripped = stripSecretPaths(withSecret);

    expect(stripped).toEqual({
      region: { timezone: 'Asia/Dhaka' },
      communications: { sms: { provider: 'mimsms', mimsms: { senderId: 'BIDDALOY' } } },
    });
    expect(JSON.stringify(stripped)).not.toContain('REDACTED');
  });

  it('strips every provider credential, not just the sms one', () => {
    const stripped = stripSecretPaths({
      communications: {
        whatsapp: { phoneNumberId: '123', accessToken: SECRET },
        email: { host: 'smtp.test', password: SECRET },
        messenger: { pageId: '456', accessToken: SECRET },
      },
    });

    expect(JSON.stringify(stripped)).not.toContain(SECRET);
    expect(stripped).toEqual({
      communications: {
        whatsapp: { phoneNumberId: '123' },
        email: { host: 'smtp.test' },
        messenger: { pageId: '456' },
      },
    });
  });

  it('leaves the source object untouched', () => {
    stripSecretPaths(withSecret);

    expect(withSecret.communications.sms.mimsms.apiKey).toBe(SECRET);
  });
});

describe('deepMergePresent', () => {
  // Business-critical: an imported settings object never carries secrets
  // (export strips them), so a merge that only overwrites present keys is
  // what keeps the destination's stored credentials alive.
  it('keeps an existing secret that the incoming object does not mention', () => {
    const existing = {
      communications: { sms: { mimsms: { apiKey: SECRET, senderId: 'OLD' } } },
    };
    const incoming = {
      communications: { sms: { mimsms: { senderId: 'NEW' } } },
    };

    expect(deepMergePresent(existing, incoming)).toEqual({
      communications: { sms: { mimsms: { apiKey: SECRET, senderId: 'NEW' } } },
    });
  });

  it('returns the existing settings unchanged when nothing is imported', () => {
    const existing = { communications: { sms: { mimsms: { apiKey: SECRET } } } };

    expect(deepMergePresent(existing, null)).toEqual(existing);
  });

  it('builds from scratch when there are no existing settings', () => {
    expect(deepMergePresent(null, { region: { timezone: 'Asia/Dhaka' } })).toEqual({
      region: { timezone: 'Asia/Dhaka' },
    });
  });

  it('replaces a non-object value rather than merging into it', () => {
    expect(deepMergePresent({ a: 'old' }, { a: 'new' })).toEqual({ a: 'new' });
  });
});

describe('diffFields', () => {
  it('names only the profile fields that actually changed', () => {
    const existing = makeSchool();
    const row = schoolTab.fromRow(toCells(existing), 2, importCtx);
    if ('errors' in row) throw new Error('fixture should parse');

    expect(schoolTab.diffFields(row.row, existing)).toEqual([]);

    expect(schoolTab.diffFields({ ...row.row, phone: '01999999999' }, existing)).toEqual(['phone']);
  });
});
